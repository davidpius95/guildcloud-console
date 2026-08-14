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
// Real-world ceiling for the network_access_attach install+join script.
// apt dist-upgrade can trigger a systemd package upgrade, which triggers a
// dracut initramfs rebuild - alone often exceeds a single guest-exec poll
// window. This is a total-elapsed cap across many worker cycles (see
// network_access_attach below), not a single blocking wait.
const NETWORK_ATTACH_EXEC_MAX_MS = 900_000;

// Waits for a cloud-init/unattended-upgrade apt run to release its locks
// before we install anything ourselves.
//
// The bracket classes are load-bearing, not style: `pgrep -f` matches
// against the FULL command line, and this guard runs inside an `sh -c`
// whose own command line contains the pattern. A plain 'apt|dpkg|...'
// therefore matches the guard's own shell, so the loop waits on itself
// and NEVER exits - the real root cause of every network_access_attach
// failure investigated on 2026-08-14 (three separate instances, each
// blamed on a different symptom: the 180s timeout, then a guest-agent
// restart). '[a]pt' matches the literal text "apt" in a real apt
// process, but not the literal text "[a]pt" in this guard's own cmdline.
//
// Also bounded (~10min) so a genuinely stuck package manager can never
// hang this stage indefinitely - it proceeds and fails honestly instead.
const PACKAGE_MANAGER_WAIT =
  "i=0; while [ $i -lt 300 ] && pgrep -f '[a]pt|[d]pkg|[d]nf|[y]um|[p]acman' >/dev/null 2>&1; do sleep 2; i=$((i+1)); done";

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

// Writes a cloud-init snippet into Proxmox's local:snippets store.
//
// This is a direct filesystem write, not an API call, because Proxmox has no
// API for creating snippets: POST /nodes/{node}/storage/{storage}/upload only
// accepts content types iso, vztmpl and import (verified against PVE 9.2).
// Attempting a snippets upload returns an empty body, which is what previously
// surfaced as "Unexpected end of JSON input" mid-provision.
//
// SNIPPETS_DIR is a bind mount of the node's /var/lib/vz/snippets into the
// (unprivileged) worker container. The host directory carries an ACL granting
// uid 100000 - the host-side identity of the container's root - write access;
// without it the mount is read-only to us. Files land as 0644 owned by that
// uid, which the Proxmox daemon (real root) can still read.
//
// Note this is why the real worker runs on the Guild-A LXC and not as a
// deployed Edge Function: this path does not exist in Supabase's runtime, the
// same constraint that already forced the move in Phase 2 (Proxmox's private
// LAN IP is unreachable from Supabase's cloud).
const SNIPPETS_DIR = Deno.env.get("SNIPPETS_DIR") ?? "/var/lib/vz/snippets";

function writeSnippet(filename: string, content: string) {
  Deno.writeTextFileSync(`${SNIPPETS_DIR}/${filename}`, content, { mode: 0o644 });
}

function deleteSnippet(filename: string) {
  try {
    Deno.removeSync(`${SNIPPETS_DIR}/${filename}`);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) {
      console.log(JSON.stringify({ ok: false, where: "deleteSnippet", filename, error: String(e) }));
    }
  }
}

// Real bug fixed: ssh_keys only ever reached a VM's cloud-init once, at
// creation - adding or removing an org key later did nothing for
// already-running instances, including revocation. Writes the org's
// current full key set directly into the guest's authorized_keys via
// agent/exec whenever mark_org_instances_ssh_dirty flags an instance
// dirty. See deploy/site-worker-guild-a/index.js for the real, live copy.
//
// Real bug found live: a naive full-file overwrite deleted a
// pre-existing, intentional operator key baked into the template that
// isn't tracked in ssh_keys at all. Fixed with a marker-delimited
// managed block - only that block is ever replaced, everything else in
// the file (an operator's own key, etc.) is preserved.
const SSH_SYNC_BEGIN_MARKER = "# BEGIN GUILDCLOUD MANAGED KEYS - do not edit this block by hand, it is overwritten on every sync";
const SSH_SYNC_END_MARKER = "# END GUILDCLOUD MANAGED KEYS";

async function processPendingSshKeySyncs(supabase: ReturnType<typeof createClient>) {
  const { data: pending, error } = await supabase
    .from("instances")
    .select("id, organization_id, proxmox_vmid")
    .eq("ssh_keys_sync_pending", true)
    .eq("state", "ready");
  if (error) {
    console.log(JSON.stringify({ ok: false, where: "processPendingSshKeySyncs_select", error: error.message }));
    return;
  }
  if (!pending || pending.length === 0) return;

  const token = await proxmoxToken(supabase);
  for (const inst of pending as { id: string; organization_id: string; proxmox_vmid: number }[]) {
    try {
      const { data: keys } = await supabase.from("ssh_keys").select("public_key").eq("organization_id", inst.organization_id);
      const content = (keys ?? []).map((k: { public_key: string }) => k.public_key).join("\n");
      const managedBlock = `${SSH_SYNC_BEGIN_MARKER}\n${content}\n${SSH_SYNC_END_MARKER}\n`;
      // Real bug found live: printf '%s\n' "<JSON.stringify'd string>" left
      // literal backslash-n text instead of real newlines - double-quoted
      // shell strings don't interpret \n, only printf's FORMAT string does.
      // Base64 sidesteps shell quoting/escaping entirely.
      const encoded = btoa(managedBlock);
      const script = `mkdir -p /home/guildvm/.ssh && touch /home/guildvm/.ssh/authorized_keys && awk '/^${SSH_SYNC_BEGIN_MARKER}$/{skip=1} /^${SSH_SYNC_END_MARKER}$/{skip=0; next} !skip' /home/guildvm/.ssh/authorized_keys > /tmp/gc_preserved_keys && cat /tmp/gc_preserved_keys > /home/guildvm/.ssh/authorized_keys && echo ${encoded} | base64 -d >> /home/guildvm/.ssh/authorized_keys && rm -f /tmp/gc_preserved_keys && chmod 700 /home/guildvm/.ssh && chmod 600 /home/guildvm/.ssh/authorized_keys && chown -R guildvm:guildvm /home/guildvm/.ssh`;
      const exec = await pve(token, "POST", `nodes/${NODE}/qemu/${inst.proxmox_vmid}/agent/exec`, {
        command: ["sh", "-c", script],
      });
      await waitForGuestExec(token, inst.proxmox_vmid, exec.pid as number);
      await supabase.from("instances").update({ ssh_keys_sync_pending: false }).eq("id", inst.id);
    } catch (e) {
      console.log(JSON.stringify({ ok: false, where: "processPendingSshKeySyncs", instance_id: inst.id, error: String(e) }));
    }
  }
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

// Real instance deletion, closing a gap flagged repeatedly across
// docs/phase-2/threat-model.md and docs/phase-3/threat-model.md: there was
// no way to actually remove the Proxmox VM or the enrolled Tailscale
// device a real instance leaves behind. `deleteInstance` (the console
// Server Action) only ever sets `instances.state = 'deleting'` - this is
// the async worker side that does the real teardown, same
// pending-row-picked-up-by-the-worker pattern as `applyPendingProjectAcls`.
// Runs once per invocation, before the stage loop.
async function processPendingInstanceDeletions(supabase: ReturnType<typeof createClient>) {
  const { data: pending, error } = await supabase
    .from("instances")
    .select("id, proxmox_vmid, tailscale_device_id")
    .eq("state", "deleting");
  if (error) {
    console.log(JSON.stringify({ ok: false, where: "processPendingInstanceDeletions_select", error: error.message }));
    return;
  }
  if (!pending || pending.length === 0) return;

  const token = await proxmoxToken(supabase);
  const tsToken = await tailscaleAccessToken(supabase);

  for (const inst of pending as { id: string; proxmox_vmid: number | null; tailscale_device_id: string | null }[]) {
    try {
      if (inst.proxmox_vmid) {
        // Stop before delete - Proxmox refuses to destroy a running VM.
        // Best-effort: a VM that's already stopped 500s harmlessly here.
        try {
          await pve(token, "POST", `nodes/${NODE}/qemu/${inst.proxmox_vmid}/status/stop`);
          await new Promise((r) => setTimeout(r, 3000));
        } catch (_e) {
          // already stopped, or stopping - proceed to delete either way
        }
        await pve(token, "DELETE", `nodes/${NODE}/qemu/${inst.proxmox_vmid}`);
      }
      if (inst.tailscale_device_id) {
        // Best-effort, not blocking: a device that fails to delete here
        // is a hygiene gap (an inert, tagged registration), not a live
        // credential leak - keys are already ephemeral/single-use. Don't
        // let a Tailscale-side failure leave the Proxmox VM undeleted or
        // the instance row stuck.
        try {
          await ts(tsToken, "DELETE", `device/${inst.tailscale_device_id}`);
        } catch (e) {
          console.log(JSON.stringify({ ok: false, where: "ts_device_delete", instance_id: inst.id, error: String(e) }));
        }
      }
      await supabase.from("instances").delete().eq("id", inst.id);
    } catch (e) {
      console.log(JSON.stringify({ ok: false, where: "processPendingInstanceDeletions", instance_id: inst.id, error: String(e) }));
      // left 'deleting' deliberately - next invocation retries
    }
  }
}

async function markStage(
  supabase: ReturnType<typeof createClient>,
  stage: StageRow,
  patch: Record<string, unknown>,
) {
  // Real bug found live: this is a partial Postgres update, so a stage
  // that succeeds after an earlier retry_wait (which recorded an `error`)
  // kept the stale error text forever - the success patch never touched
  // that column. Clear it by default whenever a stage completes, unless
  // the caller explicitly sets one (the failure path does).
  const finalPatch = (patch.status === "done" || patch.status === "skipped") && !("error" in patch)
    ? { ...patch, error: null }
    : patch;
  await supabase.from("operation_stages").update(finalPatch).eq("id", stage.id);
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
      if (!passes) throw new Error(`Not enough memory on this site to create this instance right now (${availableGb.toFixed(1)} GB available, ${requestedGb} GB needed). Try again in a few minutes or choose a smaller plan.`);
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
      if (operation.kind === "instance.resize") {
        const targetPlanId = (operation.stages as Record<string, unknown> | null)?.target_plan_id as string;
        const { data: plan } = await supabase.from("catalog_plans").select("id, vcpu, memory_gb").eq("id", targetPlanId).single();
        const p = plan as { id: string; vcpu: number; memory_gb: number } | null;
        if (p && inst.proxmox_vmid) {
          await pve(token, "PUT", `nodes/${NODE}/qemu/${inst.proxmox_vmid}/config`, { cores: p.vcpu, memory: p.memory_gb * 1024 });
          await supabase.from("instances").update({ catalog_plan_id: p.id }).eq("id", inst.id);
        }
        await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString(), detail: { resized_to: targetPlanId } });
      } else if (operation.kind === "instance.snapshot") {
        const snapname = (operation.stages as Record<string, unknown> | null)?.proxmox_snapname as string;
        if (snapname && inst.proxmox_vmid) {
          await pve(token, "POST", `nodes/${NODE}/qemu/${inst.proxmox_vmid}/snapshot`, { snapname, description: "GuildCloud snapshot" });
          await supabase.from("instance_snapshots").update({ state: "ready" }).eq("proxmox_snapname", snapname);
        }
        await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString(), detail: { snapname } });
      } else if (operation.kind === "instance.restore_replace") {
        const snapname = (operation.stages as Record<string, unknown> | null)?.proxmox_snapname as string;
        if (snapname && inst.proxmox_vmid) {
          const upid = await pve(token, "POST", `nodes/${NODE}/qemu/${inst.proxmox_vmid}/snapshot/${snapname}/rollback`);
          await waitForTask(token, upid as unknown as string);
        }
        await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString(), detail: { restored_from: snapname } });
      } else {
        const { data: tmpl } = await supabase.from("catalog_image_site_templates").select("proxmox_vmid, proxmox_node, proxmox_storage").eq("catalog_image_id", inst.catalog_image_id).eq("site_id", "lag-1").single();
        const t = tmpl as { proxmox_vmid: number; proxmox_node: string; proxmox_storage: string };
        const newid = 100000 + Math.floor(Math.random() * 800000);
        const upid = await pve(token, "POST", `nodes/${NODE}/qemu/${t.proxmox_vmid}/clone`, {
          newid,
          name: inst.name,
          pool: "guildcloud-guild-a",
          full: 0,
        });
        await waitForTask(token, upid as unknown as string);
        await supabase.from("instances").update({ proxmox_vmid: newid, proxmox_node: NODE }).eq("id", inst.id);
        await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString(), detail: { vmid: newid } });
      }
    } else if (next.stage === "template_cloud_init") {
      const { data: instance } = await supabase.from("instances").select("id, catalog_plan_id, proxmox_vmid, password_ssh_enabled, project_id").eq("id", operation.instance_id).single();
      const inst = instance as { id: string; catalog_plan_id: string; proxmox_vmid: number; password_ssh_enabled: boolean; project_id: string };

      if (operation.kind === "instance.resize" || operation.kind === "instance.restore_replace") {
        try {
          const startUpid = await pve(token, "POST", `nodes/${NODE}/qemu/${inst.proxmox_vmid}/status/reboot`);
          await waitForTask(token, startUpid as unknown as string);
        } catch {
          const startUpid = await pve(token, "POST", `nodes/${NODE}/qemu/${inst.proxmox_vmid}/status/start`);
          await waitForTask(token, startUpid as unknown as string);
        }
        await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString() });
      } else if (operation.kind === "instance.snapshot") {
        await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString() });
      } else {
        const { data: plan } = await supabase.from("catalog_plans").select("vcpu, memory_gb").eq("id", inst.catalog_plan_id).single();
        const p = plan as { vcpu: number; memory_gb: number };

        const { data: orgKeys } = await supabase
          .from("ssh_keys")
          .select("public_key")
          .eq("organization_id", operation.organization_id);
        const sshkeysRaw = (orgKeys ?? []).map((k: { public_key: string }) => k.public_key).join("\n");
        const sshkeys = sshkeysRaw ? encodeURIComponent(sshkeysRaw) : "";

        const password = crypto.randomUUID() + crypto.randomUUID();
        if (inst.password_ssh_enabled) {
          await supabase.rpc("set_vault_secret", {
            p_secret_name: `instance_ssh_password_${inst.id}`,
            p_secret_value: password,
          });
        }

        // Generate Tailscale auth key and upload a per-instance cloud-init
        // user-data snippet containing the install+join runcmd. This runs the
        // Tailscale install during cloud-init's final stage, as root in an
        // unrestricted context — bypassing the virt_qemu_ga_t SELinux domain
        // that blocks outbound TCP connections from guest-agent exec'd
        // processes on Fedora/RHEL.
        const tsToken = await tailscaleAccessToken(supabase);
        const { data: projectRow } = await supabase.from("projects").select("slug").eq("id", inst.project_id).single();
        const proj = projectRow as { slug: string };
        const hostname = `instance-${inst.id.slice(0, 8)}`;
        const tsKey = await ts(tsToken, "POST", `tailnet/${TAILSCALE_TAILNET}/keys`, {
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
          expirySeconds: 3600,
        });
        // This goes in vendor-data, NOT user-data. cicustom entries *replace*
        // the file Proxmox would otherwise generate (QemuServer/Cloudinit.pm
        // only generates each one when no custom volid is set), and the
        // generated user-data is what carries ciuser, cipassword, sshkeys and
        // hostname. Putting our runcmd in user= silently strips all four -
        // every instance would come up with no SSH key and no password.
        // vendor-data has no such generated content to displace.
        //
        // Because we are replacing vendor-data, this file also has to carry
        // what the shared tailscale-vendor.yaml did for template clones: the
        // guest agent, and password auth when the customer opted into it.
        const snippetFilename = `guildcloud-${inst.proxmox_vmid}.yaml`;
        const vendorLines = [
          "#cloud-config",
          "# Per-instance vendor-data written by the GuildCloud site worker.",
          `ssh_pwauth: ${inst.password_ssh_enabled ? "true" : "false"}`,
          "runcmd:",
          "  - [ systemctl, enable, --now, qemu-guest-agent ]",
        ];
        if (inst.password_ssh_enabled) {
          vendorLines.push(
            `  - [ sh, -c, "printf 'PasswordAuthentication yes\\nKbdInteractiveAuthentication no\\n' > /etc/ssh/sshd_config.d/00-guild-auth.conf" ]`,
            `  - [ sh, -c, "systemctl restart ssh 2>/dev/null || systemctl restart sshd 2>/dev/null || true" ]`,
          );
        }
        vendorLines.push(
          `  - [ sh, -c, "if ! command -v tailscale >/dev/null 2>&1; then curl -fsSL https://tailscale.com/install.sh | sh; fi && systemctl enable --now tailscaled && tailscale up --authkey ${tsKey.key} --hostname ${hostname} --accept-dns=true 2>&1 | tee /tmp/ts-install.log" ]`,
        );
        writeSnippet(snippetFilename, vendorLines.join("\n") + "\n");

        // Preserve any other cicustom entries, replacing only vendor= (the
        // template's shared snippet, which our per-instance one supersedes).
        const vmConfig = await pve(token, "GET", `nodes/${NODE}/qemu/${inst.proxmox_vmid}/config`) as { cicustom?: string };
        const cicustomParts = (vmConfig.cicustom ?? "").split(",").filter((part: string) => part && !part.startsWith("vendor="));
        cicustomParts.push(`vendor=local:snippets/${snippetFilename}`);

        await pve(token, "PUT", `nodes/${NODE}/qemu/${inst.proxmox_vmid}/config`, {
          cores: p.vcpu,
          memory: p.memory_gb * 1024,
          ...(sshkeys ? { sshkeys } : {}),
          cipassword: password,
          nameserver: "8.8.8.8 1.1.1.1",
          cicustom: cicustomParts.join(","),
        });
        const startUpid = await pve(token, "POST", `nodes/${NODE}/qemu/${inst.proxmox_vmid}/status/start`);
        await waitForTask(token, startUpid as unknown as string);
        await markStage(supabase, next, {
          status: "done",
          finished_at: new Date().toISOString(),
          detail: { ts_via_cloud_init: true, hostname, ts_snippet_filename: snippetFilename },
        });
      }
    } else if (next.stage === "network_access_attach") {
      const { data: instance } = await supabase.from("instances").select("id, project_id, proxmox_vmid, private_ip").eq("id", operation.instance_id).single();
      const inst = instance as { id: string; project_id: string; proxmox_vmid: number; private_ip: string | null };
      const { data: project } = await supabase.from("projects").select("slug, tailscale_acl_state").eq("id", inst.project_id).single();
      const proj = project as { slug: string; tailscale_acl_state: string };

      if (operation.kind !== "instance.create" && inst?.private_ip) {
        await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString(), detail: { private_ip: inst.private_ip } });
      } else {
        if (proj.tailscale_acl_state !== "applied") {
          await markStage(supabase, next, { status: "active", detail: { waiting_on: "tailscale_acl" } });
          return { status: "retry_wait", waitMs: VERIFY_RETRY_MS };
        }

        try {
          await pve(token, "POST", `nodes/${NODE}/qemu/${inst.proxmox_vmid}/agent/ping`);
        } catch (e) {
          await markStage(supabase, next, { status: "active", error: String(e) });
          return { status: "retry_wait", waitMs: VERIFY_RETRY_MS };
        }

        const stageStartedAt = (next.detail as { stage_started_at?: string })?.stage_started_at ?? new Date().toISOString();

        const { data: tciStageRow } = await supabase
          .from("operation_stages")
          .select("detail")
          .eq("operation_id", operation.id)
          .eq("stage", "template_cloud_init")
          .single();
        const tciDetail = tciStageRow?.detail as { ts_via_cloud_init?: boolean; hostname?: string; ts_snippet_filename?: string } | null;
        const usedCloudInit = tciDetail?.ts_via_cloud_init === true;
        const hostname = tciDetail?.hostname ?? `instance-${inst.id.slice(0, 8)}`;

        if (usedCloudInit) {
          // Cloud-init approach: poll for device enrollment.
          const tsToken = await tailscaleAccessToken(supabase);
          const devices = await ts(tsToken, "GET", `tailnet/${TAILSCALE_TAILNET}/devices`);
          const device = (devices.devices as Array<{ hostname: string; name: string; addresses: string[]; id: string }> ?? [])
            .find((d) => d.hostname === hostname);

          if (!device) {
            const elapsedMs = Date.now() - new Date(stageStartedAt).getTime();
            if (elapsedMs > NETWORK_ATTACH_EXEC_MAX_MS) {
              throw new Error(`network_access_attach (cloud-init): device ${hostname} did not appear in Tailscale after ${elapsedMs}ms — check /tmp/ts-install.log in the VM`);
            }
            await markStage(supabase, next, {
              status: "active",
              detail: { stage_started_at: stageStartedAt, waiting_on: "tailscale_device_registration", hostname },
            });
            return { status: "retry_wait", waitMs: VERIFY_RETRY_MS };
          }

          if (tciDetail?.ts_snippet_filename) {
            deleteSnippet(tciDetail.ts_snippet_filename);
          }
          await supabase.from("instances").update({
            private_ip: device.addresses[0],
            private_hostname: device.name,
            tailscale_device_id: device.id,
          }).eq("id", inst.id);
          await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString(), detail: { private_ip: device.addresses[0] } });
        } else {
          // Legacy exec approach (backward-compat for Ubuntu/Debian provisions
          // from before the cloud-init approach shipped).
          const detail = next.detail as { exec_pid?: number; hostname?: string; stage_started_at?: string };
          if (!detail?.exec_pid) {
            const tsToken = await tailscaleAccessToken(supabase);
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
              command: ["sh", "-c", `cloud-init status --wait 2>/dev/null || true; ${PACKAGE_MANAGER_WAIT} && if ! command -v tailscale >/dev/null 2>&1; then curl -fsSL https://tailscale.com/install.sh | sh; fi && systemctl enable --now tailscaled && tailscale up --authkey ${key.key} --hostname ${hostname} --accept-dns=true`],
            });
            await markStage(supabase, next, {
              status: "active",
              detail: { exec_pid: exec.pid, exec_started_at: new Date().toISOString(), hostname, stage_started_at: stageStartedAt },
            });
            return { status: "retry_wait", waitMs: VERIFY_RETRY_MS };
          }

          let execStatus: { exited?: boolean; exitcode?: number; "err-data"?: string; "out-data"?: string };
          try {
            execStatus = await pve(token, "GET", `nodes/${NODE}/qemu/${inst.proxmox_vmid}/agent/exec-status`, { pid: detail.exec_pid }) as {
              exited?: boolean; exitcode?: number; "err-data"?: string; "out-data"?: string;
            };
          } catch (e) {
            const totalElapsedMs = Date.now() - new Date(stageStartedAt).getTime();
            if (totalElapsedMs > NETWORK_ATTACH_EXEC_MAX_MS) {
              throw new Error(`network_access_attach gave up after ${totalElapsedMs}ms, most recently losing guest-exec tracking: ${String(e)}`);
            }
            await markStage(supabase, next, {
              status: "active",
              detail: { hostname, stage_started_at: stageStartedAt, waiting_on: "guest_exec_lost_retrying" },
              error: String(e),
            });
            return { status: "retry_wait", waitMs: VERIFY_RETRY_MS };
          }

          if (!execStatus.exited) {
            const elapsedMs = Date.now() - new Date(stageStartedAt).getTime();
            if (elapsedMs > NETWORK_ATTACH_EXEC_MAX_MS) {
              throw new Error(`guest exec pid ${detail.exec_pid} did not finish within ${NETWORK_ATTACH_EXEC_MAX_MS}ms`);
            }
            await markStage(supabase, next, { status: "active", detail: { ...detail, stage_started_at: stageStartedAt } });
            return { status: "retry_wait", waitMs: VERIFY_RETRY_MS };
          }
          if (execStatus.exitcode !== 0) {
            throw new Error(`guest exec pid ${detail.exec_pid} failed (exit ${execStatus.exitcode}): ${execStatus["err-data"] ?? execStatus["out-data"] ?? ""}`);
          }

          const tsToken2 = await tailscaleAccessToken(supabase);
          const devices2 = await ts(tsToken2, "GET", `tailnet/${TAILSCALE_TAILNET}/devices`);
          const device2 = (devices2.devices as Array<{ hostname: string; name: string; addresses: string[]; id: string }> ?? [])
            .find((d) => d.hostname === detail.hostname);
          if (!device2) {
            await markStage(supabase, next, { status: "active", detail: { ...detail, stage_started_at: stageStartedAt, waiting_on: "tailscale_device_registration" } });
            return { status: "retry_wait", waitMs: VERIFY_RETRY_MS };
          }
          await supabase.from("instances").update({
            private_ip: device2.addresses[0],
            private_hostname: device2.name,
            tailscale_device_id: device2.id,
          }).eq("id", inst.id);
          await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString(), detail: { private_ip: device2.addresses[0] } });
        }
      }
    } else if (next.stage === "backup_monitoring_attach") {
      // guild-a-standard-daily covers all guests (all=1) so every provisioned
      // VM is automatically enrolled — no per-VM API call needed and no
      // Sys.Audit permission required. Record the static known schedule.
      const { data: instance } = await supabase
        .from("instances")
        .select("proxmox_vmid")
        .eq("id", operation.instance_id)
        .single();
      const inst2 = instance as { proxmox_vmid: number | null };
      const detail = {
        backup_job: "guild-a-standard-daily",
        storage: "guild-pbs",
        schedule: "0 2 * * *",
        mode: "snapshot",
        retention: "keep-daily=7",
        auto_enrolled: true,
        proxmox_vmid: inst2?.proxmox_vmid ?? null,
      };
      await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString(), detail });
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
      // Real bug found live: this reservation was never released on
      // success, so it stayed 'held' (and counted against preflight) for
      // its full 15-minute expiry even though Proxmox's own live memory
      // stats already reflect the now-real VM's usage - double-counting
      // the same capacity twice and causing spurious preflight failures
      // for anything created in that window (see
      // docs/phase-2/threat-model.md finding #10). The reservation only
      // needs to cover the window before the VM actually exists.
      await supabase.from("capacity_reservations").update({ state: "released" }).eq("operation_id", operation.id);
      await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString() });
      return { status: "operation_succeeded" };
    }

    return { status: "advanced" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Same reasoning as the 'ready' path: whatever real Proxmox usage
    // exists from a partially-completed operation is already reflected
    // in the node's own live memory stats, so this bookkeeping row is
    // redundant either way - release it rather than let it double-count
    // capacity for a failed operation too.
    await supabase.from("capacity_reservations").update({ state: "released" }).eq("operation_id", operation.id);
    await markStage(supabase, next, { status: "failed", finished_at: new Date().toISOString(), error: message });
    await supabase.from("operations").update({ state: "failed", failure_reason: message, ended_at: new Date().toISOString() }).eq("id", operation.id);
    if (operation.instance_id) {
      await supabase.from("instances").update({ state: "failed" }).eq("id", operation.instance_id);
    }
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

  try {
    await processPendingInstanceDeletions(supabase);
  } catch (e) {
    log.push({ ok: false, stage: "process_pending_instance_deletions", error: String(e) });
  }

  try {
    await processPendingSshKeySyncs(supabase);
  } catch (e) {
    log.push({ ok: false, stage: "process_pending_ssh_key_syncs", error: String(e) });
  }

  while (Date.now() < deadline) {
    // Re-selects the oldest pending/running lag-1 operation on every loop
    // iteration, not cached - if the current operation just terminated,
    // this naturally moves on to the next queued one within the same
    // invocation, still one operation at a time, oldest-first.
    const { data: ops } = await supabase
      .from("operations")
      .select("id, organization_id, instance_id, site_id, kind, stages")
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

    if (outcome.status === "no_pending_stage") {
      await supabase.from("operations").update({ state: "succeeded", ended_at: new Date().toISOString() }).eq("id", operation.id);
      await supabase.from("instances").update({ state: "ready" }).eq("id", operation.instance_id);
      continue;
    }
    if (outcome.status === "retry_wait") {
      await new Promise((r) => setTimeout(r, outcome.waitMs));
    }
    // "advanced", "operation_succeeded", "operation_failed": loop
    // immediately, no wait - there may be more work ready right now.
  }

  return new Response(JSON.stringify({ ok: true, log }), { status: 200 });
});
