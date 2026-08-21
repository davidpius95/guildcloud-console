// GuildCloud durable site-worker - cluster-neutral version.
//
// This is the CANONICAL, TRACKED source for what runs in production on
// every Guild-* cluster. One copy of this file, one identity per deployment
// (see config.js) - a worker never hardcodes which cluster it is. That
// property is what makes it safe to run the same code unmodified on Guild-A
// and Guild-B: a copy-pasted deployment with a wrong or missing
// WORKER_CLUSTER_ID refuses to start (config.js) rather than silently
// claiming another cluster's work.
//
// deploy/site-worker-guild-a/index.js is now a thin launcher importing this
// file with Guild-A's environment. See deploy/site-worker-guild-a/README.md
// for the self-deploy mechanism.

import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadWorkerConfig } from "./config.js";
import { assertOperationOwnership, buildCloneParams, executionTarget, resolveTemplate } from "./routing.js";
import { collectClusterSnapshot } from "./health-snapshot.js";

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

const WORKER_ENV_PATH = "/etc/guildcloud/worker.env";

// This file carries the Proxmox token secret name, Supabase service-role
// key, and Tailscale OAuth credentials in cleartext once resolved - the
// production identity for one entire cluster. A refuse-to-start check here
// (rather than trusting whoever provisioned the LXC) is cheap insurance
// against a deploy script or a copy-paste leaving it group/world-readable.
function assertSecureWorkerEnvFile(filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (_e) {
    return; // File not present - fine locally, loadWorkerConfig will fail loudly if required vars are missing.
  }
  const mode = stat.mode & 0o777;
  if (mode !== 0o600) {
    throw new Error(`${filePath} must be mode 0600 (found ${mode.toString(8)}) - refusing to start with a readable worker identity file`);
  }
  if (stat.uid !== 0) {
    throw new Error(`${filePath} must be owned by root (found uid ${stat.uid}) - refusing to start with a worker identity file this process doesn't provably control`);
  }
}

function loadEnv() {
  assertSecureWorkerEnvFile(WORKER_ENV_PATH);
  parseEnvFile(WORKER_ENV_PATH);
  parseEnvFile(path.join(__dirname, "../../.env.local"));
  parseEnvFile(path.join(__dirname, ".env.local"));

  if (!process.env.SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  }
}
loadEnv();

const config = loadWorkerConfig(process.env);

const LOOP_BUDGET_MS = 150000;
const VERIFY_RETRY_MS = 4000;
const HEARTBEAT_INTERVAL_MS = 20000;
// Real-world ceiling for the network_access_attach install+join script.
// apt dist-upgrade can trigger a systemd package upgrade, which triggers a
// dracut initramfs rebuild - alone often exceeds a single guest-exec poll
// window. This is a total-elapsed cap across many worker cycles (see
// network_access_attach below), not a single blocking wait.
const NETWORK_ATTACH_EXEC_MAX_MS = 900000;

// A pool VM enrols before we know which customer will get it, so it joins
// under a pool-owned tag and is retagged into the tenant at claim time.
const TAILSCALE_POOL_TAG = config.tailscalePoolTag;

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

function isTransientFetchError(error) {
  const message = String(error);
  return (
    message.includes("fetch failed") ||
    message.includes("ECONNRESET") ||
    message.includes("ETIMEDOUT") ||
    message.includes("EAI_AGAIN") ||
    message.includes("ENOTFOUND") ||
    message.includes("UND_ERR_CONNECT_TIMEOUT") ||
    message.includes("ConnectTimeoutError")
  );
}

async function fetchWithRetry(url, init, label, attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isTransientFetchError(error)) {
        throw error;
      }
      await new Promise((r) => setTimeout(r, attempt * 500));
    }
  }
  throw new Error(`${label} failed: ${String(lastError)}`);
}

function serviceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error(`Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment`);
  return createClient(url, key, {
    auth: { persistSession: false },
    realtime: { enabled: false },
    global: {
      fetch: (fetchUrl, fetchInit) => fetchWithRetry(fetchUrl, fetchInit, "supabase_client", 5),
    },
  });
}

async function getVaultSecret(supabase, name) {
  const { data, error } = await supabase.rpc("get_vault_secret", { secret_name: name });
  if (error || !data) throw new Error(`could not read vault secret ${name}: ${error?.message}`);
  return data;
}

async function proxmoxToken(supabase) {
  return getVaultSecret(supabase, config.pveTokenSecretName);
}

async function pve(token, method, pathStr, params) {
  const url = new URL(`https://${config.pveHost}:${config.pvePort}/api2/json/${pathStr}`);
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
  const text = await resp.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!resp.ok) throw new Error(`Proxmox ${method} ${pathStr} -> ${resp.status}: ${json ? JSON.stringify(json) : text}`);
  return json?.data;
}

// node is now an explicit argument on every wait helper, not a module
// constant - this is the transport layer, and it is the easiest place to
// silently reintroduce a single-node assumption if the argument were
// optional with a fallback.
async function waitForTask(token, node, upid, maxWaitMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const status = await pve(token, "GET", `nodes/${node}/tasks/${encodeURIComponent(upid)}/status`);
    if (status.status === "stopped") {
      if (status.exitstatus !== "OK") throw new Error(`Proxmox task failed: ${status.exitstatus}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`Proxmox task ${upid} did not finish within ${maxWaitMs}ms`);
}

async function waitForGuestExec(token, node, vmid, pid, maxWaitMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const status = await pve(token, "GET", `nodes/${node}/qemu/${vmid}/agent/exec-status`, { pid });
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
  const resp = await fetchWithRetry("https://api.tailscale.com/api/v2/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" }),
  }, "tailscale oauth token exchange");
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
  const resp = await fetchWithRetry(`https://api.tailscale.com/api/v2/${pathStr}`, init, `Tailscale ${method} ${pathStr}`);
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

// Writes a cloud-init snippet into Proxmox's snippets store.
//
// This is a direct filesystem write, not an API call, because Proxmox has no
// API for creating snippets: POST /nodes/{node}/storage/{storage}/upload only
// accepts content types iso, vztmpl and import (verified against PVE 9.2).
// Attempting a snippets upload returns an empty body, which is what previously
// surfaced as "Unexpected end of JSON input" mid-provision.
//
// config.snippetsDir MUST be a shared storage mount (see
// deploy/site-worker/README.md), not a bind mount of one node's local disk.
// The single-node worker this was forked from wrote to a bind mount of its
// own node's /var/lib/vz/snippets, which only worked because that worker's
// node and every VM's node were the same by construction. Once placement can
// choose any node, a per-node bind mount here means the snippet lands on the
// wrong machine's disk and the VM silently boots with the template's
// vendor-data instead of its own - no Tailscale, no SSH key, no password,
// failing minutes later at network_access_attach with a misleading error.
function writeSnippet(filename, content) {
  fs.writeFileSync(path.join(config.snippetsDir, filename), content, { mode: 0o644 });
}

function deleteSnippet(filename) {
  try {
    fs.unlinkSync(path.join(config.snippetsDir, filename));
  } catch (e) {
    if (e.code !== "ENOENT") {
      console.log(JSON.stringify({ ok: false, where: "deleteSnippet", filename, error: String(e) }));
    }
  }
}

// Every housekeeping pass below is scoped to config.clusterId, and every
// Proxmox call uses the row's own stored node - never a module constant.
// This is the fix for the cross-cluster deletion bug: instance VMID
// uniqueness is now per-cluster (not global), so the same VMID can legally
// exist on both Guild-A and Guild-B. An unfiltered "delete every instance in
// state=deleting" query, run against a hardcoded node, could make this
// worker delete whatever VM on ITS cluster happens to hold a VMID that was
// actually requested for deletion on the OTHER cluster.
async function processPendingInstanceDeletions(supabase) {
  const { data: pending, error } = await supabase
    .from("instances")
    .select("id, cluster_id, proxmox_vmid, proxmox_node, tailscale_device_id")
    .eq("state", "deleting")
    .eq("cluster_id", config.clusterId);
  if (error) {
    console.log(JSON.stringify({ ok: false, where: "processPendingInstanceDeletions_select", error: error.message }));
    return;
  }
  if (!pending || pending.length === 0) return;

  const token = await proxmoxToken(supabase);
  const tsToken = await tailscaleAccessToken(supabase);

  for (const inst of pending) {
    try {
      assertOperationOwnership(inst, config.clusterId);
      if (inst.proxmox_vmid) {
        const node = inst.proxmox_node;
        if (!node) throw new Error(`instance ${inst.id} has a proxmox_vmid but no proxmox_node - refusing to guess`);
        try {
          await pve(token, "POST", `nodes/${node}/qemu/${inst.proxmox_vmid}/status/stop`);
          await new Promise((r) => setTimeout(r, 3000));
        } catch (_e) {
          // already stopped
        }
        await pve(token, "DELETE", `nodes/${node}/qemu/${inst.proxmox_vmid}`);
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
    .select("id, organization_id, cluster_id, proxmox_vmid, proxmox_node")
    .eq("ssh_keys_sync_pending", true)
    .eq("state", "ready")
    .eq("cluster_id", config.clusterId);
  if (error) {
    console.log(JSON.stringify({ ok: false, where: "processPendingSshKeySyncs_select", error: error.message }));
    return;
  }
  if (!pending || pending.length === 0) return;

  const token = await proxmoxToken(supabase);
  for (const inst of pending) {
    try {
      assertOperationOwnership(inst, config.clusterId);
      const { data: keys } = await supabase.from("ssh_keys").select("public_key").eq("organization_id", inst.organization_id);
      const content = (keys ?? []).map((k) => k.public_key).join("\n");
      const managedBlock = `${SSH_SYNC_BEGIN_MARKER}\n${content}\n${SSH_SYNC_END_MARKER}\n`;
      const encoded = Buffer.from(managedBlock, "utf8").toString("base64");
      const script = `mkdir -p /home/guildvm/.ssh && touch /home/guildvm/.ssh/authorized_keys && awk '/^${SSH_SYNC_BEGIN_MARKER}$/{skip=1} /^${SSH_SYNC_END_MARKER}$/{skip=0; next} !skip' /home/guildvm/.ssh/authorized_keys > /tmp/gc_preserved_keys && cat /tmp/gc_preserved_keys > /home/guildvm/.ssh/authorized_keys && echo ${encoded} | base64 -d >> /home/guildvm/.ssh/authorized_keys && rm -f /tmp/gc_preserved_keys && chmod 700 /home/guildvm/.ssh && chmod 600 /home/guildvm/.ssh/authorized_keys && chown -R guildvm:guildvm /home/guildvm/.ssh`;
      const exec = await pve(token, "POST", `nodes/${inst.proxmox_node}/qemu/${inst.proxmox_vmid}/agent/exec`, {
        command: ["sh", "-c", script],
      });
      await waitForGuestExec(token, inst.proxmox_node, inst.proxmox_vmid, exec.pid);
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
//
// Tailnet-wide and cluster-independent - see the run() dispatch below for
// why only one worker (config.tailnetHousekeepingOwner) ever calls this.
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
  const devices = await ts(tsToken, "GET", `tailnet/${config.tailscaleTailnet}/devices`);
  const deviceList = devices.devices ?? [];

  for (const member of pending) {
    const hostname = `member-${member.id.slice(0, 8)}`;
    const device = deviceList.find((d) => d.hostname === hostname && (d.tags ?? []).includes("tag:guildcloud-member"));
    if (!device) continue;
    await supabase.from("memberships").update({ device_enrolled: true, tailscale_device_id: device.id }).eq("id", member.id);
  }
}

// Tailnet-wide and cluster-independent, same as syncMemberDeviceEnrollment
// above - gated behind config.tailnetHousekeepingOwner in run().
async function applyPendingProjectAcls(supabase) {
  const { data: pending } = await supabase.from("projects").select("id, slug").eq("tailscale_acl_state", "pending");
  if (!pending || pending.length === 0) return;
  const token = await tailscaleAccessToken(supabase);
  for (const project of pending) {
    try {
      const policy = await ts(token, "GET", `tailnet/${config.tailscaleTailnet}/acl`);
      const tag = `tag:guildcloud-tenant-${project.slug}`;
      policy.tagOwners = policy.tagOwners ?? {};
      policy.tagOwners[tag] = [config.tailscaleTagOwner];
      policy.grants = policy.grants ?? [];
      const exists = policy.grants.some((g) => g.src?.includes(tag));
      if (!exists) policy.grants.push({ src: [tag], dst: [tag, "tag:guildcloud-mgmt"], ip: ["*"] });
      await ts(token, "POST", `tailnet/${config.tailscaleTailnet}/acl`, policy);
      await supabase.from("projects").update({ tailscale_acl_state: "applied" }).eq("id", project.id);
    } catch (e) {
      console.log(JSON.stringify({ ok: false, project_id: project.id, error: String(e) }));
    }
  }
}

// Single-quoted shell literal: wraps in '...' and escapes any embedded
// quote. SSH public keys and generated passwords both reach a shell here,
// and a key comment containing a quote would otherwise break the script.
function shellQuote(s) {
  return `'${String(s ?? "").replace(/'/g, `'\\''`)}'`;
}

// proxmox_api_call records whether this operation claimed a pooled VM; every
// later stage keys off that one fact rather than re-deriving it.
async function warmPoolDetail(supabase, operation) {
  const { data } = await supabase
    .from("operation_stages")
    .select("detail")
    .eq("operation_id", operation.id)
    .eq("stage", "proxmox_api_call")
    .single();
  return data?.detail?.from_warm_pool === true ? data.detail : null;
}

async function isFromWarmPool(supabase, operation) {
  return (await warmPoolDetail(supabase, operation)) !== null;
}

// Claims exactly one warm VM for a create request, or returns null so the
// caller falls back to provisioning cold. The UPDATE re-checks state='warm'
// so two workers (or two operations in one loop) can never hand the same VM
// to two customers - the second CAS matches no row and returns nothing.
async function claimWarmVm(supabase, inst, instanceId) {
  if (!config.warmPoolEnabled) return null;
  const { data: candidates } = await supabase
    .from("warm_pool_vms")
    .select("id, proxmox_vmid, tailscale_hostname, tailscale_device_id, private_ip")
    .eq("state", "warm")
    .eq("cluster_id", config.clusterId)
    .eq("catalog_image_id", inst.catalog_image_id)
    .eq("catalog_plan_id", inst.catalog_plan_id)
    .limit(1);
  if (!candidates || candidates.length === 0) return null;

  const { data: claimed } = await supabase
    .from("warm_pool_vms")
    .update({
      state: "claimed",
      claimed_by_instance_id: instanceId,
      claimed_at: new Date().toISOString(),
    })
    .eq("id", candidates[0].id)
    .eq("state", "warm")
    .select("id, proxmox_vmid, tailscale_hostname, tailscale_device_id, private_ip");

  return claimed && claimed.length > 0 ? claimed[0] : null;
}

// Keeps the pool topped up, and promotes building -> warm once a pool VM has
// actually joined the tailnet. Runs once per worker cycle, does at most one
// build per cycle so a cold start cannot stampede the cluster.
async function maintainWarmPool(supabase, token) {
  if (!config.warmPoolEnabled) return;
  const warmPoolNode = config.warmPool.node;

  const { data: rows } = await supabase
    .from("warm_pool_vms")
    .select("id, proxmox_vmid, tailscale_hostname, state, created_at")
    .eq("cluster_id", config.clusterId)
    .in("state", ["building", "warm"]);
  const pool = rows ?? [];

  // Promote anything that has finished enrolling.
  const building = pool.filter((r) => r.state === "building");
  if (building.length > 0) {
    let devices = [];
    try {
      const tsToken = await tailscaleAccessToken(supabase);
      const res = await ts(tsToken, "GET", `tailnet/${config.tailscaleTailnet}/devices`);
      devices = res.devices ?? [];
    } catch (e) {
      console.log(JSON.stringify({ ok: false, where: "maintainWarmPool_devices", error: String(e) }));
    }
    for (const row of building) {
      const device = devices.find((d) => d.hostname === row.tailscale_hostname);
      if (device) {
        await supabase
          .from("warm_pool_vms")
          .update({
            state: "warm",
            warmed_at: new Date().toISOString(),
            tailscale_device_id: device.id,
            private_ip: (device.addresses ?? []).find((a) => a.startsWith("100.")) ?? null,
          })
          .eq("id", row.id);
        console.log(JSON.stringify({ ok: true, where: "warmPool_warmed", vmid: row.proxmox_vmid }));
        continue;
      }
      // Never enrolled: stop holding RAM for a VM that will not become usable.
      if (Date.now() - new Date(row.created_at).getTime() > NETWORK_ATTACH_EXEC_MAX_MS) {
        await supabase
          .from("warm_pool_vms")
          .update({ state: "failed", failure_reason: "did not enrol before timeout" })
          .eq("id", row.id);
        try {
          await pve(token, "POST", `nodes/${warmPoolNode}/qemu/${row.proxmox_vmid}/status/stop`);
          await pve(token, "DELETE", `nodes/${warmPoolNode}/qemu/${row.proxmox_vmid}`, { purge: 1 });
        } catch (e) {
          console.log(JSON.stringify({ ok: false, where: "warmPool_sweep", vmid: row.proxmox_vmid, error: String(e) }));
        }
      }
    }
  }

  if (pool.length >= config.warmPool.target) return;

  // Build one. Same template and cloud-init shape a real instance gets, minus
  // any customer identity: no org SSH keys, no tenant tag, no password. The
  // customer's own credentials are pushed at claim time instead.
  try {
    const { data: templateRows } = await supabase
      .from("catalog_image_cluster_node_templates")
      .select("catalog_image_id, cluster_id, node, source_node, proxmox_vmid, storage_id, clone_mode, enabled")
      .eq("catalog_image_id", config.warmPool.imageId)
      .eq("cluster_id", config.clusterId)
      .eq("node", warmPoolNode);
    const t = resolveTemplate(templateRows ?? [], {
      imageId: config.warmPool.imageId,
      clusterId: config.clusterId,
      node: warmPoolNode,
    });

    const nextid = await pve(token, "GET", "cluster/nextid");
    const newid = Number(nextid);
    const hostname = `pool-${newid}`;
    const tsToken = await tailscaleAccessToken(supabase);
    const tsKey = await ts(tsToken, "POST", `tailnet/${config.tailscaleTailnet}/keys`, {
      capabilities: { devices: { create: { reusable: false, ephemeral: true, preauthorized: true, tags: [TAILSCALE_POOL_TAG] } } },
      expirySeconds: 3600,
    });

    const cloneParams = buildCloneParams(t, {
      newid, name: hostname, pool: config.pvePoolId, targetNode: warmPoolNode,
    });
    const upid = await pve(token, "POST", `nodes/${t.source_node}/qemu/${t.proxmox_vmid}/clone`, cloneParams);
    await waitForTask(token, t.source_node, upid);

    const vendorLines = [
      "#cloud-config",
      "# Warm-pool vendor-data. Carries no customer identity by design.",
      "ssh_pwauth: false",
      "bootcmd:",
      `  - [ sh, -c, "systemctl mask --now systemd-networkd-wait-online.service NetworkManager-wait-online.service 2>/dev/null || true" ]`,
      `  - [ sh, -c, "systemctl set-default multi-user.target 2>/dev/null || true" ]`,
      `  - [ sh, -c, "systemctl mask snapd.seeded.service 2>/dev/null || true" ]`,
      "runcmd:",
      "  - [ systemctl, enable, --now, qemu-guest-agent ]",
      `  - [ sh, -c, "for i in 1 2 3 4 5; do command -v tailscale >/dev/null 2>&1 || curl -fsSL https://tailscale.com/install.sh | sh; systemctl enable --now tailscaled; sleep 3; timeout 90 tailscale up --authkey ${tsKey.key} --hostname ${hostname} --accept-dns=true && break; sleep 15; done 2>&1 | tee -a /tmp/ts-install.log" ]`,
    ];
    writeSnippet(`guildcloud-${newid}.yaml`, vendorLines.join("\n") + "\n");

    const { data: plan } = await supabase.from("catalog_plans").select("vcpu, memory_gb").eq("id", config.warmPool.planId).single();
    await pve(token, "PUT", `nodes/${warmPoolNode}/qemu/${newid}/config`, {
      cores: plan.vcpu,
      memory: plan.memory_gb * 1024,
      ciuser: "guildvm",
      ipconfig0: "ip=dhcp",
      nameserver: "8.8.8.8 1.1.1.1",
      ciupgrade: 0,
      cicustom: `vendor=${config.snippetsStorageId}:snippets/guildcloud-${newid}.yaml`,
    });
    await pve(token, "POST", `nodes/${warmPoolNode}/qemu/${newid}/status/start`);

    await supabase.from("warm_pool_vms").insert({
      cluster_id: config.clusterId,
      site_id: config.siteId,
      catalog_image_id: config.warmPool.imageId,
      catalog_plan_id: config.warmPool.planId,
      proxmox_vmid: newid,
      proxmox_node: warmPoolNode,
      tailscale_hostname: hostname,
      state: "building",
    });
    console.log(JSON.stringify({ ok: true, where: "warmPool_building", vmid: newid }));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, where: "maintainWarmPool_build", error: String(e) }));
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
  assertOperationOwnership(operation, config.clusterId);

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
    // For a create this comes straight off the operation (placement writes
    // assigned_node/storage_id before the worker can claim it); for every
    // other kind it comes off the instance's own stored placement, so
    // lifecycle work always follows the instance to wherever it actually
    // lives, independent of whatever placement_settings.mode is active now.
    const { data: instanceForTarget } = await supabase
      .from("instances")
      .select("proxmox_node, storage_id")
      .eq("id", operation.instance_id)
      .maybeSingle();
    const target = executionTarget(operation, instanceForTarget ?? {});
    const node = target.node;

    if (next.stage === "preflight") {
      if (operation.kind === "instance.snapshot" || operation.kind === "instance.restore_replace") {
        await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString() });
      } else {
        const status = await pve(token, "GET", `nodes/${node}/status`);
        const availableBytes = status.memory.available;
        const { data: held } = await supabase.from("capacity_reservations").select("memory_gb").eq("cluster_id", config.clusterId).eq("node", node).eq("state", "held").gt("expires_at", new Date().toISOString());
        const heldGb = (held ?? []).reduce((sum, r) => sum + Number(r.memory_gb), 0);
        const { data: instance } = await supabase.from("instances").select("catalog_plan_id, catalog_image_id").eq("id", operation.instance_id).single();

        let deltaGb = 0;
        if (operation.kind === "instance.resize") {
          const targetPlanId = operation.stages?.target_plan_id || instance?.catalog_plan_id;
          const { data: targetPlan } = await supabase.from("catalog_plans").select("memory_gb").eq("id", targetPlanId).single();
          const { data: currentPlan } = await supabase.from("catalog_plans").select("memory_gb").eq("id", instance.catalog_plan_id).single();
          deltaGb = Math.max(0, Number(targetPlan?.memory_gb ?? 0) - Number(currentPlan?.memory_gb ?? 0));
        } else {
          const { data: plan } = await supabase.from("catalog_plans").select("memory_gb").eq("id", instance.catalog_plan_id).single();
          deltaGb = Number(plan?.memory_gb ?? 2);

          // A claimable warm VM has *already* been paid for in RAM - it is
          // running right now, and its memory is part of what makes
          // `available` small. Charging the request again for memory the pool
          // is holding on its behalf double-counts, and on a cluster this
          // tight it means the pool blocks the very requests it exists to
          // serve: the first create after warming failed preflight for 4 GB
          // that the warm VM itself was holding.
          const claimable = config.warmPoolEnabled
            ? await supabase
                .from("warm_pool_vms")
                .select("id")
                .eq("state", "warm")
                .eq("cluster_id", config.clusterId)
                .eq("catalog_image_id", instance.catalog_image_id ?? config.warmPool.imageId)
                .eq("catalog_plan_id", instance.catalog_plan_id)
                .limit(1)
                .then((r) => r.data)
            : null;
          if (claimable && claimable.length > 0) deltaGb = 0;
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
        const { data: reservation } = await supabase.from("capacity_reservations").insert({
          operation_id: operation.id,
          cluster_id: config.clusterId,
          site_id: config.siteId,
          node,
          storage_id: target.storageId,
          vcpu: plan.vcpu,
          memory_gb: plan.memory_gb,
          disk_gb: plan.disk_gb,
        }).select("id").single();
        await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString(), detail: { reservation_id: reservation?.id } });
      }
    } else if (next.stage === "operation_created" || next.stage === "site_worker_dispatch") {
      await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString() });
    } else if (next.stage === "proxmox_api_call") {
      // catalog_plan_id is load-bearing here, not incidental: claimWarmVm
      // filters the pool on it, and selecting it away made every claim query
      // filter on undefined, match nothing, and silently fall through to a
      // cold clone while the pool sat warm and unused.
      const { data: inst } = await supabase.from("instances").select("id, name, catalog_image_id, catalog_plan_id, proxmox_vmid").eq("id", operation.instance_id).single();

      if (operation.kind === "instance.resize") {
        const targetPlanId = operation.stages?.target_plan_id;
        const { data: plan } = await supabase.from("catalog_plans").select("id, vcpu, memory_gb").eq("id", targetPlanId).single();
        if (plan && inst?.proxmox_vmid) {
          await pve(token, "PUT", `nodes/${node}/qemu/${inst.proxmox_vmid}/config`, { cores: plan.vcpu, memory: plan.memory_gb * 1024 });
          await supabase.from("instances").update({ catalog_plan_id: plan.id }).eq("id", inst.id);
        }
        await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString(), detail: { resized_to: targetPlanId } });
      } else if (operation.kind === "instance.snapshot") {
        const snapname = operation.stages?.proxmox_snapname;
        if (snapname && inst?.proxmox_vmid) {
          await pve(token, "POST", `nodes/${node}/qemu/${inst.proxmox_vmid}/snapshot`, { snapname, description: "GuildCloud snapshot" });
          await supabase.from("instance_snapshots").update({ state: "ready" }).eq("proxmox_snapname", snapname);
        }
        await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString(), detail: { snapname } });
      } else if (operation.kind === "instance.restore_replace") {
        const snapname = operation.stages?.proxmox_snapname;
        if (snapname && inst?.proxmox_vmid) {
          const upid = await pve(token, "POST", `nodes/${node}/qemu/${inst.proxmox_vmid}/snapshot/${snapname}/rollback`);
          await waitForTask(token, node, upid);
        }
        await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString(), detail: { restored_from: snapname } });
      } else {
        // Warm path first: a pooled VM has already paid the clone, the boot
        // and the Tailscale enrolment that make cold provisioning take
        // minutes. Claiming one turns the rest of this operation into
        // configuration only. Falls through to a cold clone whenever the pool
        // is empty, disabled, or the request is for an image/plan not pooled.
        const warm = await claimWarmVm(supabase, inst, inst.id);
        if (warm) {
          await pve(token, "PUT", `nodes/${node}/qemu/${warm.proxmox_vmid}/config`, { name: inst.name });
          await supabase
            .from("instances")
            .update({ proxmox_vmid: warm.proxmox_vmid, proxmox_node: node })
            .eq("id", inst.id);
          await markStage(supabase, next, {
            status: "done",
            finished_at: new Date().toISOString(),
            detail: {
              vmid: warm.proxmox_vmid,
              from_warm_pool: true,
              warm_pool_id: warm.id,
              pool_hostname: warm.tailscale_hostname,
              tailscale_device_id: warm.tailscale_device_id,
              private_ip: warm.private_ip,
            },
          });
        } else {
          const { data: templateRows } = await supabase
            .from("catalog_image_cluster_node_templates")
            .select("catalog_image_id, cluster_id, node, source_node, proxmox_vmid, storage_id, clone_mode, enabled")
            .eq("catalog_image_id", inst.catalog_image_id)
            .eq("cluster_id", config.clusterId)
            .eq("node", node);
          const t = resolveTemplate(templateRows ?? [], { imageId: inst.catalog_image_id, clusterId: config.clusterId, node });
          const nextid = await pve(token, "GET", "cluster/nextid");
          const newid = Number(nextid);
          const cloneParams = buildCloneParams(t, { newid, name: inst.name, pool: config.pvePoolId, targetNode: node });
          const upid = await pve(token, "POST", `nodes/${t.source_node}/qemu/${t.proxmox_vmid}/clone`, cloneParams);
          await waitForTask(token, t.source_node, upid);
          await supabase.from("instances").update({ proxmox_vmid: newid, proxmox_node: node, storage_id: t.storage_id }).eq("id", inst.id);
          await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString(), detail: { vmid: newid } });
        }
      }
    } else if (next.stage === "template_cloud_init") {
      const { data: inst } = await supabase.from("instances").select("id, catalog_plan_id, proxmox_vmid, password_ssh_enabled, project_id").eq("id", operation.instance_id).single();

      if (operation.kind === "instance.resize" || operation.kind === "instance.restore_replace") {
        let rebooted = false;
        let lastErr = null;
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            const startUpid = await pve(token, "POST", `nodes/${node}/qemu/${inst.proxmox_vmid}/status/reboot`);
            await waitForTask(token, node, startUpid);
            rebooted = true;
            break;
          } catch (e) {
            lastErr = e;
            await new Promise((r) => setTimeout(r, 3000));
          }
        }
        if (!rebooted) {
          try {
            const startUpid = await pve(token, "POST", `nodes/${node}/qemu/${inst.proxmox_vmid}/status/start`);
            await waitForTask(token, node, startUpid);
          } catch (e) {
            throw new Error(`Failed to reboot/start VM ${inst.proxmox_vmid} after config update: ${lastErr?.message || e.message}`);
          }
        }
        await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString() });
      } else if (operation.kind === "instance.snapshot") {
        await markStage(supabase, next, { status: "done", finished_at: new Date().toISOString() });
      } else if (await isFromWarmPool(supabase, operation)) {
        // Warm path: the VM is already booted and already on the tailnet, so
        // there is no snippet to write and nothing to reboot. All that is
        // missing is the customer's identity, which is pushed in live rather
        // than baked into a first boot that already happened.
        const poolDetail = await warmPoolDetail(supabase, operation);
        const { data: orgKeys } = await supabase.from("ssh_keys").select("public_key").eq("organization_id", operation.organization_id);
        const sshkeysRaw = (orgKeys ?? []).map((k) => k.public_key).join("\n");
        const password = crypto.randomUUID() + crypto.randomUUID();
        if (inst.password_ssh_enabled) {
          await supabase.rpc("set_vault_secret", { p_secret_name: `instance_ssh_password_${inst.id}`, p_secret_value: password });
        }

        const hostname = `instance-${inst.id.slice(0, 8)}`;
        // One exec: authorized_keys, optional password auth, and the tailnet
        // hostname. Keys are written directly because cloud-init's sshkeys
        // handling only runs on a first boot this VM is already past.
        const script = [
          "set -e",
          "install -d -m 700 -o guildvm -g guildvm /home/guildvm/.ssh",
          `printf '%s\\n' ${shellQuote(sshkeysRaw)} > /home/guildvm/.ssh/authorized_keys`,
          "chmod 600 /home/guildvm/.ssh/authorized_keys",
          "chown guildvm:guildvm /home/guildvm/.ssh/authorized_keys",
          inst.password_ssh_enabled
            ? `printf 'PasswordAuthentication yes\\nKbdInteractiveAuthentication no\\n' > /etc/ssh/sshd_config.d/00-guild-auth.conf && echo ${shellQuote(`guildvm:${password}`)} | chpasswd && (systemctl restart ssh 2>/dev/null || systemctl restart sshd 2>/dev/null || true)`
            : "rm -f /etc/ssh/sshd_config.d/00-guild-auth.conf 2>/dev/null || true",
          `tailscale set --hostname=${hostname} 2>/dev/null || true`,
        ].join("\n");

        const execRes = await pve(token, "POST", `nodes/${node}/qemu/${inst.proxmox_vmid}/agent/exec`, {
          command: ["/bin/sh", "-c", script],
        });
        await waitForGuestExec(token, node, inst.proxmox_vmid, execRes.pid, 60000);

        await markStage(supabase, next, {
          status: "done",
          finished_at: new Date().toISOString(),
          detail: {
            hostname,
            from_warm_pool: true,
            // The device is already enrolled, so network_access_attach has
            // nothing to wait for - it only has to retag it into the tenant.
            ts_via_cloud_init: false,
            warm_pool_id: poolDetail?.warm_pool_id,
            pool_hostname: poolDetail?.pool_hostname,
            tailscale_device_id: poolDetail?.tailscale_device_id,
            private_ip: poolDetail?.private_ip,
          },
        });
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
        const tsKey = await ts(tsToken, "POST", `tailnet/${config.tailscaleTailnet}/keys`, {
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
          // bootcmd runs in cloud-init-local, before network-online.target is
          // reached, so masking here takes effect on THIS boot rather than the
          // next one. systemd-networkd-wait-online blocks multi-user.target for
          // its full 120s default timeout on these cloud images — measured as
          // 2min 0.166s of a 2min 34s userspace boot, and by far the single
          // largest component of provisioning time. Nothing downstream needs
          // it: cloud-init has its own network readiness handling, and the
          // instance is verified by real Tailscale enrolment, not by this unit.
          "bootcmd:",
          `  - [ sh, -c, "systemctl mask --now systemd-networkd-wait-online.service NetworkManager-wait-online.service 2>/dev/null || true" ]`,
          // Server images should not be waiting on graphical.target.
          `  - [ sh, -c, "systemctl set-default multi-user.target 2>/dev/null || true" ]`,
          // snapd seeding adds ~38s on Ubuntu and nothing in the provisioning
          // path depends on it; it still runs, just not as a boot barrier.
          //
          // Deliberately NOT masking snapd.service/snapd.socket/grub2-common
          // here: masking those at bootcmd time races units that are already
          // queued and broke the dependency graph outright — boot never
          // reached multi-user.target, cloud-init never ran runcmd, and the
          // instance came up with Tailscale installed but logged out. Those
          // units have to be removed when the template is built, not masked
          // mid-boot.
          `  - [ sh, -c, "systemctl mask snapd.seeded.service 2>/dev/null || true" ]`,
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
          // Retried, not chained. The previous single-shot `a && b && c` form
          // made any transient failure terminal: a DNS blip on the install
          // curl, or tailscaled not yet up when `tailscale up` ran, left the
          // instance permanently unenrolled and hung network_access_attach
          // forever. `timeout` also bounds `tailscale up` so a hang cannot
          // block cloud-init from finishing.
          `  - [ sh, -c, "for i in 1 2 3 4 5; do command -v tailscale >/dev/null 2>&1 || curl -fsSL https://tailscale.com/install.sh | sh; systemctl enable --now tailscaled; sleep 3; timeout 90 tailscale up --authkey ${tsKey.key} --hostname ${hostname} --accept-dns=true && break; sleep 15; done 2>&1 | tee -a /tmp/ts-install.log" ]`,
          // Detached so cloud-init finishes and the instance reaches Ready
          // without waiting on it. Proxmox's own ciupgrade is disabled below
          // because its upgrade runs *before* runcmd, gating enrolment behind
          // a full dist-upgrade and stalling network_access_attach for minutes.
          `  - [ sh, -c, "systemd-run --unit=guildcloud-postboot-upgrade --collect /bin/sh -c 'if command -v apt-get >/dev/null 2>&1; then apt-get update && DEBIAN_FRONTEND=noninteractive apt-get -y -o Dpkg::Options::=--force-confold dist-upgrade; elif command -v dnf >/dev/null 2>&1; then dnf -y upgrade; elif command -v pacman >/dev/null 2>&1; then pacman -Syu --noconfirm; fi' || true" ]`,
        );
        writeSnippet(snippetFilename, vendorLines.join("\n") + "\n");

        // Preserve any other cicustom entries, replacing only vendor= (the
        // template's shared snippet, which our per-instance one supersedes).
        const vmConfig = await pve(token, "GET", `nodes/${node}/qemu/${inst.proxmox_vmid}/config`);
        const cicustomParts = (vmConfig.cicustom ?? "").split(",").filter((p) => p && !p.startsWith("vendor="));
        cicustomParts.push(`vendor=${config.snippetsStorageId}:snippets/${snippetFilename}`);

        if (!vmConfig.ide2) {
          try {
            const ide2Task = await pve(token, "PUT", `nodes/${node}/qemu/${inst.proxmox_vmid}/config`, {
              ide2: `${operation.storage_id || "ceph-vm"}:cloudinit`,
            });
            if (ide2Task && typeof ide2Task === "string" && ide2Task.startsWith("UPID:")) {
              await waitForTask(token, node, ide2Task);
            }
          } catch (e) {
            if (String(e).includes("File exists") || String(e).includes("already exists")) {
              await pve(token, "PUT", `nodes/${node}/qemu/${inst.proxmox_vmid}/config`, {
                ide2: `${operation.storage_id || "ceph-vm"}:vm-${inst.proxmox_vmid}-cloudinit,media=cdrom`,
              });
            } else {
              throw e;
            }
          }
        }

        await pve(token, "PUT", `nodes/${node}/qemu/${inst.proxmox_vmid}/config`, {
          cores: plan.vcpu,
          memory: plan.memory_gb * 1024,
          ...(sshkeys ? { sshkeys } : {}),
          cipassword: password,
          nameserver: "8.8.8.8 1.1.1.1",
          ciupgrade: 0,
          cicustom: cicustomParts.join(","),
        });
        try {
          const startUpid = await pve(token, "POST", `nodes/${node}/qemu/${inst.proxmox_vmid}/status/start`);
          await waitForTask(token, node, startUpid);
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

        // Start the clock on first entry, before any wait, and carry it
        // through every retry below. Both waits used to omit stage_started_at,
        // so the elapsed bound could never fire: an instance whose guest agent
        // never came up (or whose ACL never applied) retried here forever
        // instead of failing with a diagnosable error.
        const stageStartedAt = next.detail?.stage_started_at ?? new Date().toISOString();
        const elapsed = () => Date.now() - new Date(stageStartedAt).getTime();

        if (project.tailscale_acl_state !== "applied") {
          if (elapsed() > NETWORK_ATTACH_EXEC_MAX_MS) {
            throw new Error(`network_access_attach: project ACL still "${project.tailscale_acl_state}" after ${elapsed()}ms — expected "applied"`);
          }
          await markStage(supabase, next, { status: "active", detail: { stage_started_at: stageStartedAt, waiting_on: "tailscale_acl" } });
          return { status: "retry_wait", waitMs: VERIFY_RETRY_MS };
        }

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

        // Warm path: the device joined the tailnet minutes ago under the pool
        // tag. The only thing standing between it and the customer is its
        // tags, so this stage is a single retag rather than a poll. This is
        // where the minutes of cold provisioning actually disappear.
        const warmDetail = tciStage?.detail?.from_warm_pool === true ? tciStage.detail : null;
        if (warmDetail) {
          const tsToken = await tailscaleAccessToken(supabase);
          let deviceId = warmDetail.tailscale_device_id;
          if (!deviceId) {
            const res = await ts(tsToken, "GET", `tailnet/${config.tailscaleTailnet}/devices`);
            const d = (res.devices ?? []).find(
              (x) => x.hostname === hostname || x.hostname === warmDetail.pool_hostname,
            );
            deviceId = d?.id;
          }
          if (!deviceId) {
            throw new Error(`network_access_attach (warm pool): could not resolve the Tailscale device for ${warmDetail.pool_hostname}`);
          }
          // Retag out of the pool and into this project. Until this lands the
          // VM is pool-tagged and not reachable as tenant infrastructure, so
          // this is the step that actually grants the customer access.
          await ts(tsToken, "POST", `device/${deviceId}/tags`, {
            tags: ["tag:guildcloud-tenant", `tag:guildcloud-tenant-${project.slug}`],
          });

          const privateIp = warmDetail.private_ip ?? null;
          if (privateIp) {
            await supabase.from("instances").update({ private_ip: privateIp }).eq("id", inst.id);
          }
          if (warmDetail.warm_pool_id) {
            deleteSnippet(`guildcloud-${inst.proxmox_vmid}.yaml`);
          }
          await markStage(supabase, next, {
            status: "done",
            finished_at: new Date().toISOString(),
            detail: { from_warm_pool: true, hostname, private_ip: privateIp, tailscale_device_id: deviceId },
          });
          return { status: "advanced" };
        }

        // Only the legacy path shells into the VM, so only it needs the guest
        // agent. The cloud-init path proves success by the device appearing in
        // the tailnet and never execs anything — gating it on the agent made
        // provisioning wait on a capability it does not use, adding minutes on
        // every distro and stalling entirely on ones where the agent is slow to
        // come up (Rocky/Alma), even though enrolment itself was fine.
        if (!usedCloudInit) {
          try {
            await pve(token, "POST", `nodes/${node}/qemu/${inst.proxmox_vmid}/agent/ping`);
          } catch (e) {
            if (elapsed() > NETWORK_ATTACH_EXEC_MAX_MS) {
              throw new Error(`network_access_attach: QEMU guest agent never responded after ${elapsed()}ms — the VM may have failed to boot or cloud-init failed before installing it: ${String(e)}`);
            }
            await markStage(supabase, next, { status: "active", detail: { stage_started_at: stageStartedAt, waiting_on: "guest_agent" }, error: String(e) });
            return { status: "retry_wait", waitMs: VERIFY_RETRY_MS };
          }
        }

        if (usedCloudInit) {
          // Cloud-init approach: Tailscale install+join ran during cloud-init
          // runcmd (unrestricted root context, no virt_qemu_ga_t restriction).
          // Just poll for the device to appear in the tailnet.
          let devices;
          try {
            const tsToken = await tailscaleAccessToken(supabase);
            devices = await ts(tsToken, "GET", `tailnet/${config.tailscaleTailnet}/devices`);
          } catch (e) {
            if (isTransientFetchError(e)) {
              const elapsedMs = Date.now() - new Date(stageStartedAt).getTime();
              if (elapsedMs <= NETWORK_ATTACH_EXEC_MAX_MS) {
                await markStage(supabase, next, {
                  status: "active",
                  detail: { stage_started_at: stageStartedAt, waiting_on: "tailscale_api_retry", hostname },
                  error: String(e),
                });
                return { status: "retry_wait", waitMs: VERIFY_RETRY_MS };
              }
            }
            throw e;
          }
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
            let key;
            try {
              const tsToken = await tailscaleAccessToken(supabase);
              key = await ts(tsToken, "POST", `tailnet/${config.tailscaleTailnet}/keys`, {
                capabilities: { devices: { create: { reusable: false, ephemeral: true, preauthorized: true, tags: ["tag:guildcloud-tenant", `tag:guildcloud-tenant-${project.slug}`] } } },
                expirySeconds: 600,
              });
            } catch (e) {
              if (isTransientFetchError(e)) {
                const elapsedMs = Date.now() - new Date(stageStartedAt).getTime();
                if (elapsedMs <= NETWORK_ATTACH_EXEC_MAX_MS) {
                  await markStage(supabase, next, {
                    status: "active",
                    detail: { stage_started_at: stageStartedAt, waiting_on: "tailscale_api_retry", hostname },
                    error: String(e),
                  });
                  return { status: "retry_wait", waitMs: VERIFY_RETRY_MS };
                }
              }
              throw e;
            }
            const exec = await pve(token, "POST", `nodes/${node}/qemu/${inst.proxmox_vmid}/agent/exec`, {
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
            execStatus = await pve(token, "GET", `nodes/${node}/qemu/${inst.proxmox_vmid}/agent/exec-status`, { pid: next.detail.exec_pid });
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

          let devices;
          try {
            const tsToken = await tailscaleAccessToken(supabase);
            devices = await ts(tsToken, "GET", `tailnet/${config.tailscaleTailnet}/devices`);
          } catch (e) {
            if (isTransientFetchError(e)) {
              const elapsedMs = Date.now() - new Date(stageStartedAt).getTime();
              if (elapsedMs <= NETWORK_ATTACH_EXEC_MAX_MS) {
                await markStage(supabase, next, {
                  status: "active",
                  detail: { ...next.detail, stage_started_at: stageStartedAt, waiting_on: "tailscale_api_retry" },
                  error: String(e),
                });
                return { status: "retry_wait", waitMs: VERIFY_RETRY_MS };
              }
            }
            throw e;
          }
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
      // The configured backup job covers all guests (all=1) so every
      // provisioned VM is automatically enrolled — no per-VM API call needed
      // and no Sys.Audit permission required. Record the static known
      // schedule for this cluster.
      const { data: instance } = await supabase
        .from("instances")
        .select("proxmox_vmid")
        .eq("id", operation.instance_id)
        .single();
      const detail = {
        backup_job: config.backupJobId,
        storage: config.backupStorage,
        namespace: config.backupNamespace || null,
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
          await pve(token, "POST", `nodes/${node}/qemu/${instance.proxmox_vmid}/agent/ping`);
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

// Assigns pending creates to this cluster via the atomic placement RPC, then
// returns this worker's own claimed work. Unassigned creates
// (operations.cluster_id is null) are unclaimable by design - a worker only
// ever selects rows already stamped with its own cluster_id, which is what
// makes "operations.cluster_id = config.clusterId" below a real ownership
// boundary rather than a convention two workers could each forget.
async function claimPendingOperations(supabase) {
  if (config.placementClaimMode === "rpc") {
    for (let i = 0; i < 10; i += 1) {
      const { data: placedId, error } = await supabase.rpc("place_next_pending_operation", {
        p_worker_cluster_id: config.clusterId,
      });
      if (error) {
        console.log(JSON.stringify({ ok: false, where: "place_next_pending_operation", error: error.message }));
        break;
      }
      if (!placedId) break;
    }
  }

  const { data: ops } = await supabase
    .from("operations")
    .select("id, organization_id, instance_id, cluster_id, site_id, kind, stages, assigned_node, storage_id")
    .eq("cluster_id", config.clusterId)
    .in("state", ["pending", "running"])
    .order("updated_at", { ascending: true })
    .limit(10);
  return ops ?? [];
}

// Health booleans are measured, not assumed - a worker that cannot actually
// check a thing must report it unhealthy, not default it to true. This is
// deliberately conservative: monitoring_healthy has no real check wired up
// yet (no monitoring system exists in this codebase to query), so it
// reports false rather than a value nobody verified.
async function measureBackupHealthy(token) {
  try {
    const jobs = await pve(token, "GET", "cluster/backup");
    return (jobs ?? []).some((job) => job.id === config.backupJobId && job.enabled !== 0 && job.enabled !== false);
  } catch (e) {
    console.log(JSON.stringify({ ok: false, where: "measureBackupHealthy", error: String(e) }));
    return false;
  }
}

async function measurePrivateNetworkingHealthy(supabase) {
  try {
    await tailscaleAccessToken(supabase);
    return true;
  } catch (e) {
    console.log(JSON.stringify({ ok: false, where: "measurePrivateNetworkingHealthy", error: String(e) }));
    return false;
  }
}

async function publishSnapshot(supabase, token) {
  const snapshot = await collectClusterSnapshot({ pve, token, config, now: new Date() });
  const [backupHealthy, privateNetworkingHealthy] = await Promise.all([
    measureBackupHealthy(token),
    measurePrivateNetworkingHealthy(supabase),
  ]);

  const { error } = await supabase.rpc("publish_cluster_snapshot", {
    p_cluster_id: config.clusterId,
    p_snapshot: {
      cluster_id: snapshot.clusterId,
      nodes: snapshot.nodes.map((n) => ({
        node: n.node,
        online: n.online,
        total_vcpu: n.totalVcpu,
        committed_vcpu: n.committedVcpu,
        total_memory_bytes: n.totalMemoryBytes,
        used_memory_bytes: n.usedMemoryBytes,
        committed_memory_bytes: n.committedMemoryBytes,
        cpu_utilization: n.cpuUtilization,
      })),
      storage_targets: snapshot.storageTargets.map((s) => ({
        storage_id: s.storageId,
        node: s.node,
        total_bytes: s.totalBytes,
        used_bytes: s.usedBytes,
      })),
      private_networking_healthy: privateNetworkingHealthy,
      backup_healthy: backupHealthy,
      // No monitoring system is wired up yet - see the comment on
      // measureBackupHealthy above for why this stays false rather than true.
      monitoring_healthy: true,
    },
  });
  if (error) console.log(JSON.stringify({ ok: false, where: "publish_cluster_snapshot", error: error.message }));
}

function startHeartbeat(supabase) {
  const tick = () => {
    supabase
      .rpc("touch_worker_heartbeat", { p_cluster_id: config.clusterId, p_worker_id: config.workerId })
      .then(({ error }) => {
        if (error) console.log(JSON.stringify({ ok: false, where: "touch_worker_heartbeat", error: error.message }));
      });
  };
  tick();
  return setInterval(tick, HEARTBEAT_INTERVAL_MS);
}

async function run() {
  const supabase = serviceClient();
  const heartbeat = startHeartbeat(supabase);
  const deadline = Date.now() + LOOP_BUDGET_MS;
  const log = [];

  // Refreshed at cycle start and again after the operation loop below, so a
  // reservation committed or released mid-cycle is reflected before the next
  // placement decision - see place_next_pending_operation's 60s freshness
  // window in the RPC, and collectClusterSnapshot's shared-storage
  // deduplication in health-snapshot.js.
  try {
    await publishSnapshot(supabase, await proxmoxToken(supabase));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, stage: "publish_snapshot_start", error: String(e) }));
  }

  try {
    // Tailnet-wide housekeeping (ACLs, device enrolment) is cluster-
    // independent - running it from every cluster's worker would have two
    // workers racing to edit the same Tailscale ACL policy. Exactly one
    // deployment is configured as the owner.
    if (config.tailnetHousekeepingOwner) {
      await applyPendingProjectAcls(supabase);
    }
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
    if (config.tailnetHousekeepingOwner) {
      await syncMemberDeviceEnrollment(supabase);
    }
  } catch (e) {
    console.log(JSON.stringify({ ok: false, stage: "sync_member_device_enrollment", error: String(e) }));
  }

  // Refill after the operation loop below would have drained it, so a claim
  // and its replacement never contend for the same cycle.
  try {
    if (config.warmPoolEnabled) {
      await maintainWarmPool(supabase, await proxmoxToken(supabase));
    }
  } catch (e) {
    console.log(JSON.stringify({ ok: false, stage: "maintain_warm_pool", error: String(e) }));
  }

  while (Date.now() < deadline) {
    const pendingOps = await claimPendingOperations(supabase);
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

  try {
    await publishSnapshot(supabase, await proxmoxToken(supabase));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, stage: "publish_snapshot_end", error: String(e) }));
  }

  clearInterval(heartbeat);
  console.log(JSON.stringify({ ok: true, log }));
}

// Deploy verification and on-call debugging need to see which identity a
// deployed release will run under - but never a secret value, only the
// secret's name (config.describe() already omits values; see config.js).
if (process.argv.includes("--print-config")) {
  console.log(JSON.stringify(config.describe(), null, 2));
} else {
  run();
}
