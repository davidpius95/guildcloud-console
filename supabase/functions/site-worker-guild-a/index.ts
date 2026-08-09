// GuildCloud Phase 2 durable site-worker for Guild-A.
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

import { createClient } from "jsr:@supabase/supabase-js@2";

const PVE_HOST = "192.168.8.195"; // nodeD, where the real templates live
const PVE_PORT = 8006;
const NODE = "nodeD";
const LOOP_BUDGET_MS = 150_000; // leaves headroom under a 300s service timeout
const VERIFY_RETRY_MS = 4_000; // internal guest-agent retry spacing, not tied to the external timer anymore

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

async function proxmoxToken(supabase: ReturnType<typeof createClient>) {
  // vault.decrypted_secrets is deliberately not exposed via PostgREST, so
  // this goes through the narrow get_vault_secret() wrapper function
  // (service_role-only) rather than querying the vault schema directly.
  const { data, error } = await supabase.rpc("get_vault_secret", {
    secret_name: "proxmox_guild_a_site_worker_token",
  });
  if (error || !data) throw new Error(`could not read proxmox token from vault: ${error?.message}`);
  return data as string;
}

async function pve(
  token: string,
  method: string,
  path: string,
  params?: Record<string, string | number>,
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
    for (const [k, v] of Object.entries(params)) body.set(k, String(v));
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
      // makes the clone step fast. Trade-off: the source template (vmid
      // 9000) can't be deleted/rebased while any linked clone exists - a
      // normal, accepted constraint for a stable base template.
      //
      // Real bug found live: Proxmox's clone endpoint rejects `storage`
      // for linked clones ("parameter 'storage' not allowed for linked
      // clones") - a linked clone always lives on the same storage as its
      // parent, so the field is only valid for full: 1. Confirmed via a
      // real 500 from the API, not assumed from docs.
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
      // docs/phase-2/threat-model.md finding #7). sshkeys is one or more
      // OpenSSH public keys joined by newlines; pve()'s URLSearchParams
      // encoding handles the required percent-encoding (including \n ->
      // %0A) on its own.
      const { data: orgKeys } = await supabase
        .from("ssh_keys")
        .select("public_key")
        .eq("organization_id", operation.organization_id);
      const sshkeys = (orgKeys ?? []).map((k: { public_key: string }) => k.public_key).join("\n");

      // cipassword is always overwritten - the customer opted in or not,
      // but either way the template's own fixed password never survives
      // onto a real instance. Opted-in: a real password, stashed in Vault
      // for exactly one customer-facing reveal (see
      // reveal_instance_ssh_password), then deleted - the closest honest
      // version of "never stored" for a value generated async by this
      // worker and read later from the console (see docs/phase-2/
      // data-model.md's password-SSH section). Not opted-in: a discard-only
      // random value nobody, including this worker, ever persists anywhere.
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
    } else if (next.stage === "network_access_attach" || next.stage === "backup_monitoring_attach") {
      // Explicitly out of scope this phase - private-access/Tailscale
      // enrollment is Phase 3, real PBS backup attachment is future work.
      // Marked 'skipped', not silently 'done', so this is honest in the
      // console UI, not a claim that something happened when it didn't.
      await markStage(supabase, next, { status: "skipped", finished_at: new Date().toISOString() });
    } else if (next.stage === "automated_verification") {
      const { data: instance } = await supabase.from("instances").select("proxmox_vmid").eq("id", operation.instance_id).single();
      const vmid = (instance as { proxmox_vmid: number }).proxmox_vmid;
      try {
        await pve(token, "POST", `nodes/${NODE}/qemu/${vmid}/agent/ping`);
        await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString() });
      } catch (e) {
        // Guest agent may not be up yet right after boot - this is an
        // expected, retryable condition, not a real failure. Handled as a
        // return value here (not a throw) so the outer loop can retry it
        // with a short internal wait instead of falling through to the
        // catch block below, which would incorrectly mark the whole
        // operation failed.
        await markStage(supabase, next, { status: "active", error: String(e) });
        return { status: "retry_wait", waitMs: VERIFY_RETRY_MS };
      }
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
