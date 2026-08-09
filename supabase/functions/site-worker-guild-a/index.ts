// GuildCloud Phase 2/3 durable site-worker for Guild-A.
//
// site_id 'lag-1' ("Lagos 1" in the console's customer-facing site
// picker) is what this worker filters on - the mock sites/instances data
// never had a mapping to the real infrastructure's own naming (Guild-A,
// Guild-B), and lag-1 is the default/primary mock site, so it's the one
// treated as backed by real Guild-A hardware. See the comment on the
// `sites` array in lib/mock-data.ts.
//
// Kept in source for reference/parity - the actual runtime is a Node.js
// port on a Guild-A-resident LXC (see docs/phase-2/threat-model.md finding
// #1). This Edge Function's pg_cron schedule is permanently unscheduled;
// do not re-add it (running it alongside the real worker caused a real
// state-corruption bug from two unlocked pollers racing).
//
// Loops internally, advancing through as many stages/operations as it can
// within a bounded time budget, rather than doing exactly one stage per
// invocation. The durability/retry-safety guarantee is unchanged: state
// still commits to Postgres after every single stage, so a crash mid-loop
// (timeout, cold start, process kill) loses nothing - the next invocation
// resumes from whatever was last committed, never from scratch. The loop
// only exists to remove *dead time* between stages that have nothing to
// wait on - it's a latency optimization, not a change to the durability
// model.
//
// Phase 3 addition: real per-instance Tailscale private access. The
// worker's own host (the on-network LXC, not this Edge Function copy) is
// itself Tailscale-joined (tag:guildcloud-mgmt) so it can do a real
// outbound reachability check against a newly-enrolled instance, not just
// trust the Tailscale API's self-reported device status. See
// docs/phase-3/threat-model.md.

import { createClient } from "jsr:@supabase/supabase-js@2";

const PVE_HOST = "192.168.8.195"; // nodeD, where the real templates live
const PVE_PORT = 8006;
const NODE = "nodeD";
const LOOP_BUDGET_MS = 150_000; // leaves headroom under a 300s service timeout
const VERIFY_RETRY_MS = 4_000; // internal guest-agent retry spacing, not tied to the external timer anymore
const TAILSCALE_TAILNET = "tail345216.ts.net";
const TAILSCALE_TAG_OWNER = "davidpius95@gmail.com"; // matches infra/tailscale/policy.hujson's existing convention

const STAGE_ORDER = [
  "preflight",
  "capacity_reservation",
  "operation_created",
  "site_worker_dispatch",
  "proxmox_api_call",
  "template_cloud_init",
  "network_access_attach",
  "backup_monitoring_attach",
  "automated_verification",
  "ready",
];

type StageRow = {
  id: string;
  operation_id: string;
  stage: string;
  status: string;
  attempt: number;
  detail: Record<string, unknown>;
};

type OperationRow = {
  id: string;
  organization_id: string;
  instance_id: string | null;
  site_id: string;
};

type InstanceRow = {
  id: string;
  name: string;
  site_id: string;
  catalog_image_id: string;
  catalog_plan_id: string;
};

type StageOutcome =
  | { status: "advanced" }
  | { status: "operation_succeeded" }
  | { status: "operation_failed" }
  | { status: "retry_wait"; waitMs: number }
  | { status: "no_pending_stage" };

function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function getVaultSecret(supabase: ReturnType<typeof createClient>, name: string) {
  // vault.decrypted_secrets is deliberately not exposed via PostgREST, so
  // this goes through the narrow get_vault_secret() wrapper function
  // (service_role-only) rather than querying the vault schema directly.
  const { data, error } = await supabase.rpc("get_vault_secret", { secret_name: name });
  if (error || !data) throw new Error(`could not read vault secret ${name}: ${error?.message}`);
  return data as string;
}

async function proxmoxToken(supabase: ReturnType<typeof createClient>) {
  return getVaultSecret(supabase, "proxmox_guild_a_site_worker_token");
}

async function pve(
  token: string,
  method: string,
  path: string,
  params?: Record<string, string | number | string[]>,
) {
  const url = new URL(`https://${PVE_HOST}:${PVE_PORT}/api2/json/${path}`);
  const init: RequestInit = {
    method,
    headers: { Authorization: `PVEAPIToken=${token}` },
  };
  if (params && method === "GET") {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  } else if (params) {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      // Real bug found live: Proxmox's guest-agent exec endpoint needs
      // `command` sent as repeated form fields (one per argv element),
      // not a single comma-joined string - String(["sh","-c","..."])
      // silently produces "sh,-c,..." otherwise, which Proxmox then tries
      // to execute as one literal argv[0] and fails opaquely.
      if (Array.isArray(v)) {
        for (const item of v) body.append(k, item);
      } else {
        body.set(k, String(v));
      }
    }
    init.body = body;
    init.headers = { ...init.headers, "Content-Type": "application/x-www-form-urlencoded" };
  }
  // Guild-A's Proxmox certs are self-signed - this worker only ever talks
  // to a known internal IP on a private network, not a public endpoint.
  const resp = await fetch(url, init);
  const json = await resp.json();
  if (!resp.ok) throw new Error(`Proxmox ${method} ${path} -> ${resp.status}: ${JSON.stringify(json)}`);
  return json.data;
}

async function waitForTask(token: string, upid: string, maxWaitMs = 25_000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const status = await pve(token, "GET", `nodes/${NODE}/tasks/${encodeURIComponent(upid)}/status`);
    if (status.status === "stopped") {
      if (status.exitstatus !== "OK") throw new Error(`Proxmox task failed: ${status.exitstatus}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`Proxmox task ${upid} did not finish within ${maxWaitMs}ms`);
}

async function waitForGuestExec(token: string, vmid: number, pid: number, maxWaitMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const status = await pve(token, "GET", `nodes/${NODE}/qemu/${vmid}/agent/exec-status`, { pid });
    if (status.exited) {
      if (status.exitcode !== 0) {
        throw new Error(`guest exec pid ${pid} failed (exit ${status.exitcode}): ${status["err-data"] ?? status["out-data"] ?? ""}`);
      }
      return status;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`guest exec pid ${pid} did not finish within ${maxWaitMs}ms`);
}

// --- Tailscale API helpers (Phase 3) ---
//
// The OAuth client is broadly scoped (Devices Core + Auth Keys, not
// tag-restricted) - Tailscale OAuth clients have their tag scope fixed at
// creation time, which can't cover future per-project tags created after
// the client already exists. The real isolation boundary is the ACL
// grants list (dynamically extended per project below), not the client's
// own scope - the same class of trade-off already accepted for the
// Supabase service-role key. See docs/phase-3/threat-model.md.

async function tailscaleAccessToken(supabase: ReturnType<typeof createClient>) {
  const clientId = await getVaultSecret(supabase, "tailscale_guildcloud_worker_oauth_client_id");
  const clientSecret = await getVaultSecret(supabase, "tailscale_guildcloud_worker_oauth_client_secret");
  const resp = await fetch("https://api.tailscale.com/api/v2/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" }),
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(`tailscale oauth token exchange -> ${resp.status}: ${JSON.stringify(json)}`);
  return json.access_token as string;
}

async function ts(token: string, method: string, path: string, body?: unknown) {
  const init: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { ...init.headers, "Content-Type": "application/json" };
  }
  const resp = await fetch(`https://api.tailscale.com/api/v2/${path}`, init);
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`Tailscale ${method} ${path} -> ${resp.status}: ${JSON.stringify(json)}`);
  return json;
}

// Applies each pending project's real ACL grant directly via the live API
// (not through the infra/tailscale/policy.hujson GitOps flow - per-project
// grants can't wait on a human merging a PR at signup time; this is a
// deliberate, documented exception, not a silent bypass - see the
// tag:guildcloud-tenant note in policy.hujson and docs/phase-3/threat-model.md).
// Leaves the row 'pending' on failure so the next invocation retries -
// same durable-eventual-consistency approach as everything else here.
async function applyPendingProjectAcls(supabase: ReturnType<typeof createClient>) {
  const { data: pending } = await supabase
    .from("projects")
    .select("id, slug")
    .eq("tailscale_acl_state", "pending");
  if (!pending || pending.length === 0) return;

  const token = await tailscaleAccessToken(supabase);
  for (const project of pending as { id: string; slug: string }[]) {
    try {
      const policy = await ts(token, "GET", `tailnet/${TAILSCALE_TAILNET}/acl`);
      const tag = `tag:guildcloud-tenant-${project.slug}`;
      policy.tagOwners = policy.tagOwners ?? {};
      policy.tagOwners[tag] = [TAILSCALE_TAG_OWNER];
      policy.grants = policy.grants ?? [];
      const exists = (policy.grants as Array<{ src?: string[] }>).some((g) => g.src?.includes(tag));
      if (!exists) {
        policy.grants.push({ src: [tag], dst: [tag, "tag:guildcloud-mgmt"], ip: ["*"] });
      }
      await ts(token, "POST", `tailnet/${TAILSCALE_TAILNET}/acl`, policy);
      await supabase.from("projects").update({ tailscale_acl_state: "applied" }).eq("id", project.id);
    } catch (e) {
      console.log(JSON.stringify({ ok: false, project_id: project.id, error: String(e) }));
      // left 'pending' deliberately - next invocation retries
    }
  }
}

async function markStage(
  supabase: ReturnType<typeof createClient>,
  stage: StageRow,
  patch: Record<string, unknown>,
) {
  await supabase.from("operation_stages").update(patch).eq("id", stage.id);
}

async function processOneStage(
  supabase: ReturnType<typeof createClient>,
  operation: OperationRow,
): Promise<StageOutcome> {
  const { data: stages } = await supabase
    .from("operation_stages")
    .select("id, operation_id, stage, status, attempt, detail")
    .eq("operation_id", operation.id)
    .order("stage");

  const byStage = new Map((stages as StageRow[]).map((s) => [s.stage, s]));
  const next = STAGE_ORDER.map((s) => byStage.get(s)!).find((s) => s && (s.status === "pending" || s.status === "active"));

  if (!next) return { status: "no_pending_stage" };

  await supabase.from("operations").update({ state: "running", current_stage: next.stage, updated_at: new Date().toISOString() }).eq("id", operation.id);
  await markStage(supabase, next, { status: "active", started_at: new Date().toISOString(), attempt: next.attempt + 1 });

  try {
    const token = await proxmoxToken(supabase);

    if (next.stage === "preflight") {
      const status = await pve(token, "GET", `nodes/${NODE}/status`);
      const availableBytes = status.memory.available as number;
      const { data: held } = await supabase
        .from("capacity_reservations")
        .select("memory_gb")
        .eq("node", NODE)
        .eq("state", "held")
        .gt("expires_at", new Date().toISOString());
      const heldGb = (held ?? []).reduce((sum: number, r: { memory_gb: number }) => sum + Number(r.memory_gb), 0);
      const { data: instance } = await supabase.from("instances").select("catalog_plan_id").eq("id", operation.instance_id).single();
      const { data: plan } = await supabase.from("catalog_plans").select("memory_gb, vcpu, disk_gb").eq("id", (instance as { catalog_plan_id: string }).catalog_plan_id).single();
      const requestedGb = Number((plan as { memory_gb: number }).memory_gb);
      const availableGb = availableBytes / 1024 / 1024 / 1024;
      const passes = availableGb - heldGb - requestedGb >= 0;
      if (!passes) throw new Error(`preflight failed: ${availableGb.toFixed(2)}GB available - ${heldGb}GB held - ${requestedGb}GB requested < 0`);
      await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString(), detail: { available_gb: availableGb, held_gb: heldGb, requested_gb: requestedGb } });
    } else if (next.stage === "capacity_reservation") {
      const { data: instance } = await supabase.from("instances").select("catalog_plan_id").eq("id", operation.instance_id).single();
      const { data: plan } = await supabase.from("catalog_plans").select("memory_gb, vcpu, disk_gb").eq("id", (instance as { catalog_plan_id: string }).catalog_plan_id).single();
      const p = plan as { memory_gb: number; vcpu: number; disk_gb: number };
      const { data: reservation } = await supabase
        .from("capacity_reservations")
        .insert({ operation_id: operation.id, site_id: "lag-1", node: NODE, vcpu: p.vcpu, memory_gb: p.memory_gb, disk_gb: p.disk_gb })
        .select("id")
        .single();
      await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString(), detail: { reservation_id: (reservation as { id: string }).id } });
    } else if (next.stage === "operation_created" || next.stage === "site_worker_dispatch") {
      // Administrative stages: the operation and its 9 stage rows already
      // exist by the time the worker ever runs (createInstance creates
      // them), and "dispatch" is this very invocation claiming the
      // operation above - both are true by construction at this point.
      await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString() });
    } else if (next.stage === "proxmox_api_call") {
      const { data: instance } = await supabase.from("instances").select("id, name, catalog_image_id").eq("id", operation.instance_id).single();
      const inst = instance as InstanceRow;
      const { data: tmpl } = await supabase
        .from("catalog_image_site_templates")
        .select("proxmox_vmid, proxmox_node, proxmox_storage")
        .eq("catalog_image_id", inst.catalog_image_id)
        .eq("site_id", "lag-1")
        .single();
      const t = tmpl as { proxmox_vmid: number; proxmox_node: string; proxmox_storage: string };
      const newid = 100000 + Math.floor(Math.random() * 800000); // scratch range, well clear of real guest ids
      // full: 0 (linked clone) instead of a full byte-copy - ceph-vm is RBD,
      // which supports true copy-on-write cloning, so this is what actually
      // makes the clone step fast. Trade-off: the source template can't be
      // deleted/rebased while any linked clone exists - a normal, accepted
      // constraint for a stable base template.
      const upid = await pve(token, "POST", `nodes/${NODE}/qemu/${t.proxmox_vmid}/clone`, {
        newid,
        name: inst.name,
        pool: "guildcloud-guild-a",
        full: 0,
      });
      await waitForTask(token, upid as unknown as string);
      await supabase.from("instances").update({ proxmox_vmid: newid, proxmox_node: NODE }).eq("id", inst.id);
      await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString(), detail: { vmid: newid } });
    } else if (next.stage === "template_cloud_init") {
      const { data: instance } = await supabase.from("instances").select("id, catalog_plan_id, proxmox_vmid, password_ssh_enabled").eq("id", operation.instance_id).single();
      const inst = instance as { id: string; catalog_plan_id: string; proxmox_vmid: number; password_ssh_enabled: boolean };
      const { data: plan } = await supabase.from("catalog_plans").select("vcpu, memory_gb").eq("id", inst.catalog_plan_id).single();
      const p = plan as { vcpu: number; memory_gb: number };

      // Override the template's own baked-in cloud-init identity before
      // first boot - without this, every clone silently inherits the
      // template's one shared sshkeys/cipassword (see
      // docs/phase-2/threat-model.md finding #7).
      const { data: orgKeys } = await supabase
        .from("ssh_keys")
        .select("public_key")
        .eq("organization_id", operation.organization_id);
      const sshkeys = (orgKeys ?? []).map((k: { public_key: string }) => k.public_key).join("\n");

      const password = crypto.randomUUID() + crypto.randomUUID();
      if (inst.password_ssh_enabled) {
        await supabase.rpc("set_vault_secret", {
          p_secret_name: `instance_ssh_password_${inst.id}`,
          p_secret_value: password,
        });
      }

      await pve(token, "PUT", `nodes/${NODE}/qemu/${inst.proxmox_vmid}/config`, {
        cores: p.vcpu,
        memory: p.memory_gb * 1024,
        ...(sshkeys ? { sshkeys } : {}),
        cipassword: password,
      });
      const startUpid = await pve(token, "POST", `nodes/${NODE}/qemu/${inst.proxmox_vmid}/status/start`);
      await waitForTask(token, startUpid as unknown as string);
      await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString() });
    } else if (next.stage === "network_access_attach") {
      // Phase 3: real Tailscale enrollment. Never a shared/reusable key -
      // see docs/phase-3/threat-model.md for why the old cicustom-baked
      // key was a critical finding this replaces.
      const { data: instance } = await supabase.from("instances").select("id, project_id, proxmox_vmid").eq("id", operation.instance_id).single();
      const inst = instance as { id: string; project_id: string; proxmox_vmid: number };
      const { data: project } = await supabase.from("projects").select("slug, tailscale_acl_state").eq("id", inst.project_id).single();
      const proj = project as { slug: string; tailscale_acl_state: string };

      if (proj.tailscale_acl_state !== "applied") {
        // Don't enroll a device into a tag with no reachability grant yet -
        // that would be a silent private-network island, not an error, but
        // just as unusable. Wait for applyPendingProjectAcls to catch up.
        await markStage(supabase, next, { status: "active", detail: { waiting_on: "tailscale_acl" } });
        return { status: "retry_wait", waitMs: VERIFY_RETRY_MS };
      }

      try {
        await pve(token, "POST", `nodes/${NODE}/qemu/${inst.proxmox_vmid}/agent/ping`);
      } catch (e) {
        await markStage(supabase, next, { status: "active", error: String(e) });
        return { status: "retry_wait", waitMs: VERIFY_RETRY_MS };
      }

      const tsToken = await tailscaleAccessToken(supabase);
      const hostname = `instance-${inst.id.slice(0, 8)}`;
      const key = await ts(tsToken, "POST", `tailnet/${TAILSCALE_TAILNET}/keys`, {
        capabilities: {
          devices: {
            create: {
              reusable: false,
              ephemeral: true,
              preauthorized: true,
              tags: ["tag:guildcloud-tenant", `tag:guildcloud-tenant-${proj.slug}`],
            },
          },
        },
        expirySeconds: 600,
      });

      const exec = await pve(token, "POST", `nodes/${NODE}/qemu/${inst.proxmox_vmid}/agent/exec`, {
        // tailscaled ships disabled on the template (vmid 9011) so every
        // clone starts with no bled-through node identity - it must be
        // started here, on first real enrollment, not assumed running.
        command: ["sh", "-c", `systemctl enable --now tailscaled && tailscale up --authkey ${key.key} --hostname ${hostname} --accept-dns=true`],
      });
      await waitForGuestExec(token, inst.proxmox_vmid, exec.pid as number);

      const devices = await ts(tsToken, "GET", `tailnet/${TAILSCALE_TAILNET}/devices`);
      const device = (devices.devices as Array<{ hostname: string; name: string; addresses: string[]; id: string }> ?? [])
        .find((d) => d.hostname === hostname);
      if (!device) {
        // Registration can lag a moment behind tailscale up returning.
        await markStage(supabase, next, { status: "active", detail: { waiting_on: "tailscale_device_registration" } });
        return { status: "retry_wait", waitMs: VERIFY_RETRY_MS };
      }

      await supabase.from("instances").update({
        private_ip: device.addresses[0],
        private_hostname: device.name,
        tailscale_device_id: device.id,
      }).eq("id", inst.id);

      await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString(), detail: { private_ip: device.addresses[0] } });
    } else if (next.stage === "backup_monitoring_attach") {
      // Real PBS backup attachment is future work, not this phase either.
      // Marked 'skipped', not silently 'done' - see docs/phase-2/threat-model.md.
      await markStage(supabase, next, { status: "skipped", finished_at: new Date().toISOString() });
    } else if (next.stage === "automated_verification") {
      const { data: instance } = await supabase.from("instances").select("proxmox_vmid, private_ip").eq("id", operation.instance_id).single();
      const inst = instance as { proxmox_vmid: number; private_ip: string | null };
      try {
        await pve(token, "POST", `nodes/${NODE}/qemu/${inst.proxmox_vmid}/agent/ping`);
      } catch (e) {
        // Guest agent may not be up yet right after boot - expected,
        // retryable, not a real failure.
        await markStage(supabase, next, { status: "active", error: String(e) });
        return { status: "retry_wait", waitMs: VERIFY_RETRY_MS };
      }

      // Real reachability + SSH-service check, per §7's explicit
      // verification list ("route, private DNS, Tailscale reachability,
      // SSH service") - a live TCP connect to the private IP from THIS
      // worker's own tailnet-joined host is stronger evidence than
      // trusting the Tailscale API's self-reported device status.
      //
      // NOTE: this Deno/Edge Function copy cannot actually perform a
      // local TCP probe against a private IP the way the Node.js runtime
      // on the Guild-A LXC can - kept here for parity/documentation only.
      // See the live Node.js worker for the real implementation
      // (net.Socket connect to private_ip:22).
      await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString(), detail: { private_ip: inst.private_ip } });
    } else if (next.stage === "ready") {
      await supabase.from("instances").update({ state: "ready" }).eq("id", operation.instance_id);
      await supabase.from("operations").update({ state: "succeeded", ended_at: new Date().toISOString() }).eq("id", operation.id);
      await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString() });
      return { status: "operation_succeeded" };
    }

    return { status: "advanced" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markStage(supabase, next, { status: "failed", finished_at: new Date().toISOString(), error: message });
    await supabase.from("operations").update({ state: "failed", failure_reason: message, ended_at: new Date().toISOString() }).eq("id", operation.id);
    return { status: "operation_failed" };
  }
}

Deno.serve(async () => {
  const supabase = serviceClient();
  const deadline = Date.now() + LOOP_BUDGET_MS;
  const log: unknown[] = [];

  try {
    await applyPendingProjectAcls(supabase);
  } catch (e) {
    log.push({ ok: false, stage: "apply_pending_project_acls", error: String(e) });
  }

  while (Date.now() < deadline) {
    // Re-selects the oldest pending/running lag-1 operation on every loop
    // iteration, not cached - if the current operation just terminated,
    // this naturally moves on to the next queued one within the same
    // invocation, still one operation at a time, oldest-first.
    const { data: ops } = await supabase
      .from("operations")
      .select("id, organization_id, instance_id, site_id")
      .eq("site_id", "lag-1")
      .in("state", ["pending", "running"])
      .order("started_at", { ascending: true })
      .limit(1);

    const operation = (ops as OperationRow[] | null)?.[0];
    if (!operation) {
      log.push({ ok: true, message: "no pending operations" });
      break;
    }

    const outcome = await processOneStage(supabase, operation);
    log.push({ operation_id: operation.id, ...outcome });

    if (outcome.status === "no_pending_stage") break; // inconsistent state - don't spin on it
    if (outcome.status === "retry_wait") {
      await new Promise((r) => setTimeout(r, outcome.waitMs));
    }
    // "advanced", "operation_succeeded", "operation_failed": loop
    // immediately, no wait - there may be more work ready right now.
  }

  return new Response(JSON.stringify({ ok: true, log }), { status: 200 });
});
