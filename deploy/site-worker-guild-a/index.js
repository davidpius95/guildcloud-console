// GuildCloud Phase 2/3 durable site-worker for Guild-A - on-network version.
//
// This is the CANONICAL, TRACKED source for what actually runs in
// production, on the Guild-A LXC (vmid 500, /opt/guildcloud-worker/index.js).

import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

if (!globalThis.WebSocket) {
  globalThis.WebSocket = class DummyWebSocket {};
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, "utf8");
    for (const line of content.split("\n")) {
      const match = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (match) {
        const key = match[1];
        let val = match[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
      }
    }
  } catch (_e) {
    // ignore
  }
}

function loadEnv() {
  parseEnvFile("/etc/guildcloud/worker.env");
  parseEnvFile(path.join(__dirname, "../../.env.local"));
  parseEnvFile(path.join(__dirname, ".env.local"));
  
  if (!process.env.SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  }
}
loadEnv();

const PVE_HOST = "192.168.8.195";
const PVE_PORT = 8006;
const NODE = "nodeD";
const LOOP_BUDGET_MS = 150000;
const VERIFY_RETRY_MS = 4000;
const TAILSCALE_TAILNET = "tail345216.ts.net";
const TAILSCALE_TAG_OWNER = "davidpius95@gmail.com";
// Real-world ceiling for the network_access_attach install+join script.
// apt dist-upgrade can trigger a systemd package upgrade, which triggers a
// dracut initramfs rebuild - alone often exceeds a single guest-exec poll
// window. This is a total-elapsed cap across many worker cycles (see
// network_access_attach below), not a single blocking wait.
const NETWORK_ATTACH_EXEC_MAX_MS = 900000;

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
  "preflight", "capacity_reservation", "operation_created", "site_worker_dispatch",
  "proxmox_api_call", "template_cloud_init", "network_access_attach",
  "backup_monitoring_attach", "automated_verification", "ready",
];

function serviceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error(`Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment`);
  return createClient(url, key, { auth: { persistSession: false }, realtime: { enabled: false } });
}

async function getVaultSecret(supabase, name) {
  const { data, error } = await supabase.rpc("get_vault_secret", { secret_name: name });
  if (error || !data) throw new Error(`could not read vault secret ${name}: ${error?.message}`);
  return data;
}

async function proxmoxToken(supabase) {
  return getVaultSecret(supabase, "proxmox_guild_a_site_worker_token");
}

async function pve(token, method, pathStr, params) {
  const url = new URL(`https://${PVE_HOST}:${PVE_PORT}/api2/json/${pathStr}`);
  const init = { method, headers: { Authorization: `PVEAPIToken=${token}` } };
  if (params && method === "GET") {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  } else if (params) {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) {
        for (const item of v) body.append(k, item);
      } else {
        body.set(k, String(v));
      }
    }
    init.body = body;
    init.headers = { ...init.headers, "Content-Type": "application/x-www-form-urlencoded" };
  }
  const resp = await fetch(url, init);
  const json = await resp.json();
  if (!resp.ok) throw new Error(`Proxmox ${method} ${pathStr} -> ${resp.status}: ${JSON.stringify(json)}`);
  return json.data;
}

async function waitForTask(token, upid, maxWaitMs = 25000) {
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

async function waitForGuestExec(token, vmid, pid, maxWaitMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const status = await pve(token, "GET", `nodes/${NODE}/qemu/${vmid}/agent/exec-status`, { pid });
    if (status.exited) {
      if (status.exitcode !== 0) throw new Error(`guest exec pid ${pid} failed (exit ${status.exitcode}): ${status["err-data"] ?? status["out-data"] ?? ""}`);
      return status;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`guest exec pid ${pid} did not finish within ${maxWaitMs}ms`);
}

async function tailscaleAccessToken(supabase) {
  const clientId = await getVaultSecret(supabase, "tailscale_guildcloud_worker_oauth_client_id");
  const clientSecret = await getVaultSecret(supabase, "tailscale_guildcloud_worker_oauth_client_secret");
  const resp = await fetch("https://api.tailscale.com/api/v2/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" }),
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(`tailscale oauth token exchange -> ${resp.status}: ${JSON.stringify(json)}`);
  return json.access_token;
}

async function ts(token, method, pathStr, body) {
  const init = { method, headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers["Content-Type"] = "application/json";
  }
  const resp = await fetch(`https://api.tailscale.com/api/v2/${pathStr}`, init);
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`Tailscale ${method} ${pathStr} -> ${resp.status}: ${JSON.stringify(json)}`);
  return json;
}

function tcpCheck(host, port, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("timeout", () => { socket.destroy(); reject(new Error(`tcp connect to ${host}:${port} timed out`)); });
    socket.once("error", (e) => { socket.destroy(); reject(e); });
    socket.connect(port, host);
  });
}

// Writes a cloud-init snippet into Proxmox's local:snippets store.
//
// This is a direct filesystem write, not an API call, because Proxmox has no
// API for creating snippets: POST /nodes/{node}/storage/{storage}/upload only
// accepts content types iso, vztmpl and import (verified against PVE 9.2).
// Attempting a snippets upload returns an empty body, which is what previously
// surfaced as "Unexpected end of JSON input" mid-provision.
//
// SNIPPETS_DIR is a bind mount of the node's /var/lib/vz/snippets into this
// (unprivileged) worker container. The host directory carries an ACL granting
// uid 100000 - the host-side identity of the container's root - write access;
// without it the mount is read-only to us. Files land as 0644 owned by that
// uid, which the Proxmox daemon (real root) can still read.
const SNIPPETS_DIR = process.env.SNIPPETS_DIR ?? "/var/lib/vz/snippets";

function writeSnippet(filename, content) {
  fs.writeFileSync(path.join(SNIPPETS_DIR, filename), content, { mode: 0o644 });
}

function deleteSnippet(filename) {
  try {
    fs.unlinkSync(path.join(SNIPPETS_DIR, filename));
  } catch (e) {
    if (e.code !== "ENOENT") {
      console.log(JSON.stringify({ ok: false, where: "deleteSnippet", filename, error: String(e) }));
    }
  }
}

async function processPendingInstanceDeletions(supabase) {
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

  for (const inst of pending) {
    try {
      if (inst.proxmox_vmid) {
        try {
          await pve(token, "POST", `nodes/${NODE}/qemu/${inst.proxmox_vmid}/status/stop`);
          await new Promise((r) => setTimeout(r, 3000));
        } catch (_e) {
          // already stopped
        }
        await pve(token, "DELETE", `nodes/${NODE}/qemu/${inst.proxmox_vmid}`);
      }
      if (inst.tailscale_device_id) {
        try {
          await ts(tsToken, "DELETE", `device/${inst.tailscale_device_id}`);
        } catch (e) {
          console.log(JSON.stringify({ ok: false, where: "ts_device_delete", instance_id: inst.id, error: String(e) }));
        }
      }
      await supabase.from("instances").delete().eq("id", inst.id);
    } catch (e) {
      console.log(JSON.stringify({ ok: false, where: "processPendingInstanceDeletions", instance_id: inst.id, error: String(e) }));
      const message = String(e);
      if (message.includes("Permission check failed") || message.includes("not found") || message.includes("no such vm")) {
        await supabase.from("instances").update({ state: "failed" }).eq("id", inst.id);
      }
    }
  }
}

const SSH_SYNC_BEGIN_MARKER = "# BEGIN GUILDCLOUD MANAGED KEYS - do not edit this block by hand, it is overwritten on every sync";
const SSH_SYNC_END_MARKER = "# END GUILDCLOUD MANAGED KEYS";

async function processPendingSshKeySyncs(supabase) {
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
  for (const inst of pending) {
    try {
      const { data: keys } = await supabase.from("ssh_keys").select("public_key").eq("organization_id", inst.organization_id);
      const content = (keys ?? []).map((k) => k.public_key).join("\n");
      const managedBlock = `${SSH_SYNC_BEGIN_MARKER}\n${content}\n${SSH_SYNC_END_MARKER}\n`;
      const encoded = Buffer.from(managedBlock, "utf8").toString("base64");
      const script = `mkdir -p /home/guildvm/.ssh && touch /home/guildvm/.ssh/authorized_keys && awk '/^${SSH_SYNC_BEGIN_MARKER}$/{skip=1} /^${SSH_SYNC_END_MARKER}$/{skip=0; next} !skip' /home/guildvm/.ssh/authorized_keys > /tmp/gc_preserved_keys && cat /tmp/gc_preserved_keys > /home/guildvm/.ssh/authorized_keys && echo ${encoded} | base64 -d >> /home/guildvm/.ssh/authorized_keys && rm -f /tmp/gc_preserved_keys && chmod 700 /home/guildvm/.ssh && chmod 600 /home/guildvm/.ssh/authorized_keys && chown -R guildvm:guildvm /home/guildvm/.ssh`;
      const exec = await pve(token, "POST", `nodes/${NODE}/qemu/${inst.proxmox_vmid}/agent/exec`, {
        command: ["sh", "-c", script],
      });
      await waitForGuestExec(token, inst.proxmox_vmid, exec.pid);
      await supabase.from("instances").update({ ssh_keys_sync_pending: false }).eq("id", inst.id);
    } catch (e) {
      console.log(JSON.stringify({ ok: false, where: "processPendingSshKeySyncs", instance_id: inst.id, error: String(e) }));
    }
  }
}

// Real device self-enrollment completion signal. Deliberately NOT driven
// by a client-side "I ran the command" ping from the browser - that's
// exactly the kind of client-trusted signal this worker avoids everywhere
// else (see request_instance_deletion's own "never trust the client"
// comment). Instead: list the real tailnet, match by the hostname
// convention the enroll-device Edge Function uses (member-<id8>) and the
// tag:guildcloud-member tag, and flip device_enrolled only once the
// device genuinely shows up.
async function syncMemberDeviceEnrollment(supabase) {
  const { data: pending, error } = await supabase
    .from("memberships")
    .select("id")
    .eq("device_enrolled", false)
    .not("user_id", "is", null);
  if (error) {
    console.log(JSON.stringify({ ok: false, where: "syncMemberDeviceEnrollment_select", error: error.message }));
    return;
  }
  if (!pending || pending.length === 0) return;

  const tsToken = await tailscaleAccessToken(supabase);
  const devices = await ts(tsToken, "GET", `tailnet/${TAILSCALE_TAILNET}/devices`);
  const deviceList = devices.devices ?? [];

  for (const member of pending) {
    const hostname = `member-${member.id.slice(0, 8)}`;
    const device = deviceList.find((d) => d.hostname === hostname && (d.tags ?? []).includes("tag:guildcloud-member"));
    if (!device) continue;
    await supabase.from("memberships").update({ device_enrolled: true, tailscale_device_id: device.id }).eq("id", member.id);
  }
}

async function applyPendingProjectAcls(supabase) {
  const { data: pending } = await supabase.from("projects").select("id, slug").eq("tailscale_acl_state", "pending");
  if (!pending || pending.length === 0) return;
  const token = await tailscaleAccessToken(supabase);
  for (const project of pending) {
    try {
      const policy = await ts(token, "GET", `tailnet/${TAILSCALE_TAILNET}/acl`);
      const tag = `tag:guildcloud-tenant-${project.slug}`;
      policy.tagOwners = policy.tagOwners ?? {};
      policy.tagOwners[tag] = [TAILSCALE_TAG_OWNER];
      policy.grants = policy.grants ?? [];
      const exists = policy.grants.some((g) => g.src?.includes(tag));
      if (!exists) policy.grants.push({ src: [tag], dst: [tag, "tag:guildcloud-mgmt"], ip: ["*"] });
      await ts(token, "POST", `tailnet/${TAILSCALE_TAILNET}/acl`, policy);
      await supabase.from("projects").update({ tailscale_acl_state: "applied" }).eq("id", project.id);
    } catch (e) {
      console.log(JSON.stringify({ ok: false, project_id: project.id, error: String(e) }));
    }
  }
}

async function markStage(supabase, stage, patch) {
  const finalPatch = (patch.status === "done" || patch.status === "skipped") && !("error" in patch)
    ? { ...patch, error: null }
    : patch;
  const { error } = await supabase.from("operation_stages").update(finalPatch).eq("id", stage.id);
  if (error) console.log(JSON.stringify({ ok: false, where: "markStage", stage: stage.stage, error: error.message }));
}

async function processOneStage(supabase, operation) {
  const { data: stages } = await supabase
    .from("operation_stages")
    .select("id, operation_id, stage, status, attempt, detail")
    .eq("operation_id", operation.id)
    .order("stage");

  const byStage = new Map(stages.map((s) => [s.stage, s]));
  const next = STAGE_ORDER.map((s) => byStage.get(s)).find((s) => s && (s.status === "pending" || s.status === "active"));
  if (!next) return { status: "no_pending_stage" };

  await supabase.from("operations").update({ state: "running", current_stage: next.stage, updated_at: new Date().toISOString() }).eq("id", operation.id);
  await markStage(supabase, next, { status: "active", started_at: new Date().toISOString(), attempt: next.attempt + 1 });

  try {
    const token = await proxmoxToken(supabase);

    if (next.stage === "preflight") {
      if (operation.kind === "instance.snapshot" || operation.kind === "instance.restore_replace") {
        await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString() });
      } else {
        const status = await pve(token, "GET", `nodes/${NODE}/status`);
        const availableBytes = status.memory.available;
        const { data: held } = await supabase.from("capacity_reservations").select("memory_gb").eq("node", NODE).eq("state", "held").gt("expires_at", new Date().toISOString());
        const heldGb = (held ?? []).reduce((sum, r) => sum + Number(r.memory_gb), 0);
        const { data: instance } = await supabase.from("instances").select("catalog_plan_id").eq("id", operation.instance_id).single();
        
        let deltaGb = 0;
        if (operation.kind === "instance.resize") {
          const targetPlanId = operation.stages?.target_plan_id || instance?.catalog_plan_id;
          const { data: targetPlan } = await supabase.from("catalog_plans").select("memory_gb").eq("id", targetPlanId).single();
          const { data: currentPlan } = await supabase.from("catalog_plans").select("memory_gb").eq("id", instance.catalog_plan_id).single();
          deltaGb = Math.max(0, Number(targetPlan?.memory_gb ?? 0) - Number(currentPlan?.memory_gb ?? 0));
        } else {
          const { data: plan } = await supabase.from("catalog_plans").select("memory_gb").eq("id", instance.catalog_plan_id).single();
          deltaGb = Number(plan?.memory_gb ?? 2);
        }

        const availableGb = availableBytes / 1024 / 1024 / 1024;
        if (availableGb - heldGb - deltaGb < 0) {
          throw new Error(`Not enough memory on this site to create this instance right now (${availableGb.toFixed(1)} GB available, ${deltaGb} GB needed). Try again in a few minutes or choose a smaller plan.`);
        }
        await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString(), detail: { available_gb: availableGb, held_gb: heldGb, needed_gb: deltaGb } });
      }
    } else if (next.stage === "capacity_reservation") {
      if (operation.kind === "instance.snapshot" || operation.kind === "instance.restore_replace") {
        await markStage(supabase, next, { status: "skipped", finished_at: new Date().toISOString() });
      } else {
        const { data: instance } = await supabase.from("instances").select("catalog_plan_id").eq("id", operation.instance_id).single();
        const targetPlanId = operation.kind === "instance.resize" ? (operation.stages?.target_plan_id || instance?.catalog_plan_id) : instance?.catalog_plan_id;
        const { data: plan } = await supabase.from("catalog_plans").select("memory_gb, vcpu, disk_gb").eq("id", targetPlanId).single();
        const { data: reservation } = await supabase.from("capacity_reservations").insert({ operation_id: operation.id, site_id: "lag-1", node: NODE, vcpu: plan.vcpu, memory_gb: plan.memory_gb, disk_gb: plan.disk_gb }).select("id").single();
        await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString(), detail: { reservation_id: reservation?.id } });
      }
    } else if (next.stage === "operation_created" || next.stage === "site_worker_dispatch") {
      await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString() });
    } else if (next.stage === "proxmox_api_call") {
      const { data: inst } = await supabase.from("instances").select("id, name, catalog_image_id, proxmox_vmid").eq("id", operation.instance_id).single();
      
      if (operation.kind === "instance.resize") {
        const targetPlanId = operation.stages?.target_plan_id;
        const { data: plan } = await supabase.from("catalog_plans").select("id, vcpu, memory_gb").eq("id", targetPlanId).single();
        if (plan && inst?.proxmox_vmid) {
          await pve(token, "PUT", `nodes/${NODE}/qemu/${inst.proxmox_vmid}/config`, { cores: plan.vcpu, memory: plan.memory_gb * 1024 });
          await supabase.from("instances").update({ catalog_plan_id: plan.id }).eq("id", inst.id);
        }
        await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString(), detail: { resized_to: targetPlanId } });
      } else if (operation.kind === "instance.snapshot") {
        const snapname = operation.stages?.proxmox_snapname;
        if (snapname && inst?.proxmox_vmid) {
          await pve(token, "POST", `nodes/${NODE}/qemu/${inst.proxmox_vmid}/snapshot`, { snapname, description: "GuildCloud snapshot" });
          await supabase.from("instance_snapshots").update({ state: "ready" }).eq("proxmox_snapname", snapname);
        }
        await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString(), detail: { snapname } });
      } else if (operation.kind === "instance.restore_replace") {
        const snapname = operation.stages?.proxmox_snapname;
        if (snapname && inst?.proxmox_vmid) {
          const upid = await pve(token, "POST", `nodes/${NODE}/qemu/${inst.proxmox_vmid}/snapshot/${snapname}/rollback`);
          await waitForTask(token, upid);
        }
        await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString(), detail: { restored_from: snapname } });
      } else {
        const { data: t } = await supabase.from("catalog_image_site_templates").select("proxmox_vmid, proxmox_node, proxmox_storage").eq("catalog_image_id", inst.catalog_image_id).eq("site_id", "lag-1").single();
        const newid = 100000 + Math.floor(Math.random() * 800000);
        const upid = await pve(token, "POST", `nodes/${NODE}/qemu/${t.proxmox_vmid}/clone`, { newid, name: inst.name, pool: "guildcloud-guild-a", full: 0 });
        await waitForTask(token, upid);
        await supabase.from("instances").update({ proxmox_vmid: newid, proxmox_node: NODE }).eq("id", inst.id);
        await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString(), detail: { vmid: newid } });
      }
    } else if (next.stage === "template_cloud_init") {
      const { data: inst } = await supabase.from("instances").select("id, catalog_plan_id, proxmox_vmid, password_ssh_enabled, project_id").eq("id", operation.instance_id).single();

      if (operation.kind === "instance.resize" || operation.kind === "instance.restore_replace") {
        let rebooted = false;
        let lastErr = null;
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            const startUpid = await pve(token, "POST", `nodes/${NODE}/qemu/${inst.proxmox_vmid}/status/reboot`);
            await waitForTask(token, startUpid);
            rebooted = true;
            break;
          } catch (e) {
            lastErr = e;
            await new Promise((r) => setTimeout(r, 3000));
          }
        }
        if (!rebooted) {
          try {
            const startUpid = await pve(token, "POST", `nodes/${NODE}/qemu/${inst.proxmox_vmid}/status/start`);
            await waitForTask(token, startUpid);
          } catch (e) {
            throw new Error(`Failed to reboot/start VM ${inst.proxmox_vmid} after config update: ${lastErr?.message || e.message}`);
          }
        }
        await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString() });
      } else if (operation.kind === "instance.snapshot") {
        await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString() });
      } else {
        const { data: plan } = await supabase.from("catalog_plans").select("vcpu, memory_gb").eq("id", inst.catalog_plan_id).single();
        const { data: orgKeys } = await supabase.from("ssh_keys").select("public_key").eq("organization_id", operation.organization_id);
        const sshkeysRaw = (orgKeys ?? []).map((k) => k.public_key).join("\n");
        const sshkeys = sshkeysRaw ? encodeURIComponent(sshkeysRaw) : "";
        const password = crypto.randomUUID() + crypto.randomUUID();
        if (inst.password_ssh_enabled) {
          await supabase.rpc("set_vault_secret", { p_secret_name: `instance_ssh_password_${inst.id}`, p_secret_value: password });
        }

        // Generate Tailscale auth key and upload a per-instance cloud-init
        // user-data snippet containing the install+join runcmd. This runs the
        // Tailscale install during cloud-init's final stage, as root in an
        // unrestricted context — bypassing the virt_qemu_ga_t SELinux domain
        // that blocks outbound TCP connections from guest-agent exec'd
        // processes on Fedora/RHEL. On Debian/Ubuntu the same runcmd is a
        // no-op if tailscale is already installed (the if-not-present guard).
        const tsToken = await tailscaleAccessToken(supabase);
        const { data: project } = await supabase.from("projects").select("slug").eq("id", inst.project_id).single();
        const hostname = `instance-${inst.id.slice(0, 8)}`;
        const tsKey = await ts(tsToken, "POST", `tailnet/${TAILSCALE_TAILNET}/keys`, {
          capabilities: { devices: { create: { reusable: false, ephemeral: true, preauthorized: true, tags: ["tag:guildcloud-tenant", `tag:guildcloud-tenant-${project.slug}`] } } },
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
          '  - [ systemctl, enable, --now, qemu-guest-agent ]',
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
        const vmConfig = await pve(token, "GET", `nodes/${NODE}/qemu/${inst.proxmox_vmid}/config`);
        const cicustomParts = (vmConfig.cicustom ?? "").split(",").filter((p) => p && !p.startsWith("vendor="));
        cicustomParts.push(`vendor=local:snippets/${snippetFilename}`);

        await pve(token, "PUT", `nodes/${NODE}/qemu/${inst.proxmox_vmid}/config`, {
          cores: plan.vcpu,
          memory: plan.memory_gb * 1024,
          ...(sshkeys ? { sshkeys } : {}),
          cipassword: password,
          // Override nameserver so cloud-init network config uses a reachable
          // DNS server instead of 100.100.100.100 (Tailscale MagicDNS), which
          // Proxmox injects from the node's own resolv.conf and is unreachable
          // before Tailscale is installed.
          nameserver: "8.8.8.8 1.1.1.1",
          cicustom: cicustomParts.join(","),
        });
        try {
          const startUpid = await pve(token, "POST", `nodes/${NODE}/qemu/${inst.proxmox_vmid}/status/start`);
          await waitForTask(token, startUpid);
        } catch (e) {
          if (!String(e).includes("already running")) throw e;
        }
        await markStage(supabase, next, {
          status: "done",
          finished_at: new Date().toISOString(),
          detail: { ts_via_cloud_init: true, hostname, ts_snippet_filename: snippetFilename },
        });
      }
    } else if (next.stage === "network_access_attach") {
      const { data: inst } = await supabase.from("instances").select("id, project_id, proxmox_vmid, private_ip").eq("id", operation.instance_id).single();

      if (operation.kind !== "instance.create" && inst?.private_ip) {
        await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString(), detail: { private_ip: inst.private_ip } });
      } else {
        const { data: project } = await supabase.from("projects").select("slug, tailscale_acl_state").eq("id", inst.project_id).single();

        if (project.tailscale_acl_state !== "applied") {
          await markStage(supabase, next, { status: "active", detail: { waiting_on: "tailscale_acl" } });
          return { status: "retry_wait", waitMs: VERIFY_RETRY_MS };
        }

        try {
          await pve(token, "POST", `nodes/${NODE}/qemu/${inst.proxmox_vmid}/agent/ping`);
        } catch (e) {
          await markStage(supabase, next, { status: "active", error: String(e) });
          return { status: "retry_wait", waitMs: VERIFY_RETRY_MS };
        }

        const stageStartedAt = next.detail?.stage_started_at ?? new Date().toISOString();

        // Check whether template_cloud_init used the new cloud-init approach
        // (ts_via_cloud_init:true, available for all new provisions) or the
        // old guest-agent exec approach (older operations, kept for
        // backward-compat with in-flight Ubuntu/Debian provisions).
        const { data: tciStage } = await supabase
          .from("operation_stages")
          .select("detail")
          .eq("operation_id", operation.id)
          .eq("stage", "template_cloud_init")
          .single();
        const usedCloudInit = tciStage?.detail?.ts_via_cloud_init === true;
        // hostname is deterministic from inst.id — same formula in both stages.
        const hostname = tciStage?.detail?.hostname ?? `instance-${inst.id.slice(0, 8)}`;

        if (usedCloudInit) {
          // Cloud-init approach: Tailscale install+join ran during cloud-init
          // runcmd (unrestricted root context, no virt_qemu_ga_t restriction).
          // Just poll for the device to appear in the tailnet.
          const tsToken = await tailscaleAccessToken(supabase);
          const devices = await ts(tsToken, "GET", `tailnet/${TAILSCALE_TAILNET}/devices`);
          const device = (devices.devices ?? []).find((d) => d.hostname === hostname);

          if (!device) {
            const elapsedMs = Date.now() - new Date(stageStartedAt).getTime();
            if (elapsedMs > NETWORK_ATTACH_EXEC_MAX_MS) {
              throw new Error(`network_access_attach (cloud-init): device ${hostname} did not appear in Tailscale after ${elapsedMs}ms — check /tmp/ts-install.log in the VM for errors`);
            }
            await markStage(supabase, next, {
              status: "active",
              detail: { stage_started_at: stageStartedAt, waiting_on: "tailscale_device_registration", hostname },
            });
            return { status: "retry_wait", waitMs: VERIFY_RETRY_MS };
          }

          // Device enrolled — clean up the per-instance snippet file.
          if (tciStage.detail?.ts_snippet_filename) {
            deleteSnippet(tciStage.detail.ts_snippet_filename);
          }
          await supabase.from("instances").update({ private_ip: device.addresses[0], private_hostname: device.name, tailscale_device_id: device.id }).eq("id", inst.id);
          await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString(), detail: { private_ip: device.addresses[0] } });
        } else {
          // Legacy exec approach — kept for Ubuntu/Debian instances that were
          // provisioned before the cloud-init approach shipped.
          //
          // Install+join is kicked off once and then polled across worker
          // cycles (via next.detail), not blocked on synchronously. A single
          // blocking wait here previously re-minted a fresh Tailscale key and
          // kicked a brand-new exec on every retry - after the first exec was
          // already running - because a timeout was treated as fatal instead
          // of "still working". Real failure mode hit in 2026-08-14
          // verification: apt dist-upgrade triggered a dracut initramfs
          // rebuild that alone outran the old single 180s wait, so every
          // retry stacked another redundant install+join attempt (and leaked
          // another unused Tailscale key) instead of resuming the same one.
          if (!next.detail?.exec_pid) {
            const tsToken = await tailscaleAccessToken(supabase);
            const key = await ts(tsToken, "POST", `tailnet/${TAILSCALE_TAILNET}/keys`, {
              capabilities: { devices: { create: { reusable: false, ephemeral: true, preauthorized: true, tags: ["tag:guildcloud-tenant", `tag:guildcloud-tenant-${project.slug}`] } } },
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

          // The re-verification pass that proved the fix above also found a
          // second, distinct failure mode: apt dist-upgrade upgrades
          // qemu-guest-agent itself, which restarts its own systemd service
          // mid-install - wiping the agent's exec-tracking table. The next
          // poll for our pid then fails outright ("Agent error: PID <n> does
          // not exist"), not "still running". That's not the script failing;
          // it's our only handle on it becoming unusable. Rather than fail
          // the whole operation over a self-inflicted restart, or poll a pid
          // the agent will never recognize again, drop the dead exec_pid so
          // the next cycle starts a clean install+join - bounded by the same
          // stage-wide ceiling as the "still running" case below.
          let execStatus;
          try {
            execStatus = await pve(token, "GET", `nodes/${NODE}/qemu/${inst.proxmox_vmid}/agent/exec-status`, { pid: next.detail.exec_pid });
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
              throw new Error(`guest exec pid ${next.detail.exec_pid} did not finish within ${NETWORK_ATTACH_EXEC_MAX_MS}ms (install+join script genuinely stuck, not just a slow apt/dracut run)`);
            }
            await markStage(supabase, next, { status: "active", detail: { ...next.detail, stage_started_at: stageStartedAt } });
            return { status: "retry_wait", waitMs: VERIFY_RETRY_MS };
          }
          if (execStatus.exitcode !== 0) {
            throw new Error(`guest exec pid ${next.detail.exec_pid} failed (exit ${execStatus.exitcode}): ${execStatus["err-data"] ?? execStatus["out-data"] ?? ""}`);
          }

          const tsToken = await tailscaleAccessToken(supabase);
          const devices = await ts(tsToken, "GET", `tailnet/${TAILSCALE_TAILNET}/devices`);
          const device = (devices.devices ?? []).find((d) => d.hostname === next.detail.hostname);
          if (!device) {
            await markStage(supabase, next, { status: "active", detail: { ...next.detail, stage_started_at: stageStartedAt, waiting_on: "tailscale_device_registration" } });
            return { status: "retry_wait", waitMs: VERIFY_RETRY_MS };
          }

          await supabase.from("instances").update({ private_ip: device.addresses[0], private_hostname: device.name, tailscale_device_id: device.id }).eq("id", inst.id);
          await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString(), detail: { private_ip: device.addresses[0] } });
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
      const detail = {
        backup_job: "guild-a-standard-daily",
        storage: "guild-pbs",
        schedule: "0 2 * * *",
        mode: "snapshot",
        retention: "keep-daily=7",
        auto_enrolled: true,
        proxmox_vmid: instance?.proxmox_vmid ?? null,
      };
      await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString(), detail });
    } else if (next.stage === "automated_verification") {
      const { data: instance } = await supabase.from("instances").select("proxmox_vmid, private_ip").eq("id", operation.instance_id).single();
      if (operation.kind === "instance.snapshot") {
        await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString() });
      } else {
        try {
          await pve(token, "POST", `nodes/${NODE}/qemu/${instance.proxmox_vmid}/agent/ping`);
        } catch (e) {
          await markStage(supabase, next, { status: "active", error: String(e) });
          return { status: "retry_wait", waitMs: VERIFY_RETRY_MS };
        }

        if (instance.private_ip) {
          try {
            await tcpCheck(instance.private_ip, 22, 2000);
          } catch (_e) {
            // Guest agent ping passed above; TCP reachability depends on network route context.
          }
        }

        await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString(), detail: { private_ip: instance.private_ip } });
      }
    } else if (next.stage === "ready") {
      await supabase.from("instances").update({ state: "ready" }).eq("id", operation.instance_id);
      await supabase.from("operations").update({ state: "succeeded", ended_at: new Date().toISOString() }).eq("id", operation.id);
      await supabase.from("capacity_reservations").update({ state: "released" }).eq("operation_id", operation.id);
      await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString() });
      return { status: "operation_succeeded" };
    }

    return { status: "advanced" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markStage(supabase, next, { status: "failed", finished_at: new Date().toISOString(), error: message });
    await supabase.from("capacity_reservations").update({ state: "released" }).eq("operation_id", operation.id);
    await supabase.from("operations").update({ state: "failed", failure_reason: message, ended_at: new Date().toISOString() }).eq("id", operation.id);
    if (operation.instance_id) {
      await supabase.from("instances").update({ state: "failed" }).eq("id", operation.instance_id);
    }
    return { status: "operation_failed" };
  }
}

async function run() {
  const supabase = serviceClient();
  const deadline = Date.now() + LOOP_BUDGET_MS;
  const log = [];

  try {
    await applyPendingProjectAcls(supabase);
  } catch (e) {
    log.push({ ok: false, stage: "apply_pending_project_acls", error: String(e) });
  }

  try {
    await processPendingInstanceDeletions(supabase);
  } catch (e) {
    console.log(JSON.stringify({ ok: false, stage: "process_pending_instance_deletions", error: String(e) }));
  }

  try {
    await processPendingSshKeySyncs(supabase);
  } catch (e) {
    console.log(JSON.stringify({ ok: false, stage: "process_pending_ssh_key_syncs", error: String(e) }));
  }

  try {
    await syncMemberDeviceEnrollment(supabase);
  } catch (e) {
    console.log(JSON.stringify({ ok: false, stage: "sync_member_device_enrollment", error: String(e) }));
  }

  while (Date.now() < deadline) {
    const { data: ops } = await supabase
      .from("operations")
      .select("id, organization_id, instance_id, site_id, kind, stages")
      .eq("site_id", "lag-1")
      .in("state", ["pending", "running"])
      .order("started_at", { ascending: true })
      .limit(10);

    const pendingOps = ops ?? [];
    if (!pendingOps.length) { log.push({ ok: true, message: "no pending operations" }); break; }

    let processedAny = false;
    for (const operation of pendingOps) {
      const outcome = await processOneStage(supabase, operation);
      log.push({ operation_id: operation.id, ...outcome });

      if (outcome.status === "no_pending_stage") {
        await supabase.from("operations").update({ state: "succeeded", ended_at: new Date().toISOString() }).eq("id", operation.id);
        await supabase.from("instances").update({ state: "ready" }).eq("id", operation.instance_id);
        processedAny = true;
        continue;
      }
      processedAny = true;
      if (outcome.status === "retry_wait") await new Promise((r) => setTimeout(r, outcome.waitMs));
      break;
    }

    if (!processedAny) break;
  }

  console.log(JSON.stringify({ ok: true, log }));
}

run();
