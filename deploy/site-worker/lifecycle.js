function requireText(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} is required`);
  return value.trim();
}

function requireTaskId(value, operation) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${operation} did not return a task id`);
  }
  return value;
}

function parseDiskGiB(value) {
  const size = String(value ?? "").match(/(?:^|,)size=(\d+(?:\.\d+)?)([KMGT])(?:,|$)/i);
  if (!size) return null;
  const unitGiB = { K: 1 / 1024 / 1024, M: 1 / 1024, G: 1, T: 1024 };
  return Number(size[1]) * unitGiB[size[2].toUpperCase()];
}

function resolveBootDisk(config) {
  const diskPattern = /^(?:scsi|virtio|sata|ide)\d+$/;
  const ordered = String(config.boot ?? "")
    .replace(/^order=/, "")
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const configured = Object.keys(config).filter(
    (key) => diskPattern.test(key) && parseDiskGiB(config[key]) !== null,
  );
  const disk = ordered.find((key) => configured.includes(key)) ??
    (configured.length === 1 ? configured[0] : null);
  if (!disk) throw new Error("could not identify the VM boot disk");
  return { disk, diskGb: parseDiskGiB(config[disk]) };
}

function validateTarget(target) {
  const normalized = {
    vcpu: Number(target?.vcpu),
    memory_gb: Number(target?.memory_gb),
    disk_gb: Number(target?.disk_gb),
  };
  for (const [key, value] of Object.entries(normalized)) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`target ${key} must be positive`);
  }
  return normalized;
}

export async function createSnapshot({ pve, waitForTask, token, node, vmid, snapname }) {
  const snapshot = requireText(snapname, "snapshot name");
  const upid = requireTaskId(
    await pve(token, "POST", `nodes/${node}/qemu/${vmid}/snapshot`, {
      snapname: snapshot,
      description: "GuildCloud snapshot",
    }),
    "snapshot request",
  );
  await waitForTask(token, node, upid);
  const snapshots = await pve(token, "GET", `nodes/${node}/qemu/${vmid}/snapshot`);
  const exists = Array.isArray(snapshots) && snapshots.some(
    (entry) => entry?.name === snapshot || entry?.snapname === snapshot,
  );
  if (!exists) throw new Error(`snapshot ${snapshot} was not observed after task completion`);
  return { proxmox_task_id: upid, snapshot };
}

export async function rollbackSnapshot({ pve, waitForTask, token, node, vmid, snapname }) {
  const snapshot = requireText(snapname, "snapshot name");
  const upid = requireTaskId(
    await pve(
      token,
      "POST",
      `nodes/${node}/qemu/${vmid}/snapshot/${encodeURIComponent(snapshot)}/rollback`,
    ),
    "snapshot rollback",
  );
  await waitForTask(token, node, upid);
  return { proxmox_task_id: upid, snapshot };
}

// The boot disk a clone inherits is the template's, not the plan's. Every
// instance created before 2026-09-01 shipped with the template's 16 GiB no
// matter which plan was bought, because create applied cores and memory from
// the catalogue and never touched the disk -- only resize did. Growing before
// first boot matters: cloud-init's growpart/resizefs runs then, so the guest
// filesystem picks the new size up on its own. Never shrinks.
export async function ensureBootDiskSize({ pve, waitForTask, token, node, vmid, diskGb }) {
  const target = Number(diskGb);
  if (!Number.isFinite(target) || target <= 0) throw new Error("target disk_gb must be positive");
  const before = await pve(token, "GET", `nodes/${node}/qemu/${vmid}/config`);
  const { disk, diskGb: current } = resolveBootDisk(before);
  if (current >= target) return { disk, disk_gb: current, grown: false };

  // Whole GiB only: Proxmox rejects fractional deltas, and rounding up can
  // only overshoot the plan, never leave the customer short.
  const growth = Math.ceil(target - current);
  const upid = requireTaskId(
    await pve(token, "PUT", `nodes/${node}/qemu/${vmid}/resize`, { disk, size: `+${growth}G` }),
    "boot disk resize",
  );
  await waitForTask(token, node, upid);

  const after = await pve(token, "GET", `nodes/${node}/qemu/${vmid}/config`);
  const observed = parseDiskGiB(after[disk]);
  if (!(Number(observed) >= target)) {
    throw new Error(
      `boot disk ${disk} did not reach ${target}G after resize (observed ${observed}G)`,
    );
  }
  return { disk, disk_gb: observed, grown: true };
}

// Proxmox holds /var/lock/qemu-server/lock-<vmid>.conf for the duration of a
// config or disk operation, and a 64 GiB grow on Guild-A's ceph-vm storage holds
// it for far longer than Guild-B's local-lvm does. The original restart was four
// attempts three seconds apart, so on Guild-A it exhausted its budget while the
// lock was still held and failed the whole resize -- leaving the instance
// `degraded` with the config already applied. Cluster speed decided whether a
// resize worked.
//
// So: wait for the lock to clear rather than racing it, retry transient lock
// errors on a budget sized for the slow cluster, pick reboot vs start from the
// VM's actual state instead of guessing, and confirm the VM is running before
// reporting success -- a restart that leaves it off is the failure this is here
// to prevent.
const TRANSIENT_RESTART_ERROR = /can't lock file|got timeout|lock-\d+\.conf|VM is locked|still locked/i;

export function isTransientRestartError(error) {
  return TRANSIENT_RESTART_ERROR.test(String(error?.message ?? error ?? ""));
}

export async function restartInstanceAfterConfigChange({
  pve,
  waitForTask,
  token,
  node,
  vmid,
  budgetMs = 300000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
}) {
  const statusPath = `nodes/${node}/qemu/${vmid}/status/current`;
  const deadline = now() + budgetMs;
  let delayMs = 2000;
  let lastError = null;
  const backoff = async () => {
    await sleep(delayMs);
    delayMs = Math.min(delayMs * 2, 15000);
  };

  while (now() < deadline) {
    const status = await pve(token, "GET", statusPath);

    // A held lock is the expected state right after the disk grow, not an
    // error. Waiting it out is the whole fix.
    if (status?.lock) {
      lastError = new Error(`VM ${vmid} is locked by Proxmox (${status.lock})`);
      await backoff();
      continue;
    }

    const action = status?.status === "running" ? "reboot" : "start";
    try {
      const upid = await pve(token, "POST", `nodes/${node}/qemu/${vmid}/status/${action}`);
      await waitForTask(token, node, upid);
      // Confirm rather than assume: a completed task is not proof the VM came
      // back up, and a resize that reports success over a powered-off VM is
      // exactly the silent failure this stage used to produce.
      while (now() < deadline) {
        const settled = await pve(token, "GET", statusPath);
        if (settled?.status === "running") return { restarted: true, action };
        if (!settled?.lock && settled?.status === "stopped") {
          const startUpid = await pve(token, "POST", `nodes/${node}/qemu/${vmid}/status/start`);
          await waitForTask(token, node, startUpid);
        }
        await backoff();
      }
      throw new Error(`VM ${vmid} did not reach a running state after ${action}`);
    } catch (error) {
      if (String(error?.message ?? error).includes("already running")) {
        return { restarted: true, action: "already-running" };
      }
      // Anything that is not the lock is a real fault: fail fast rather than
      // burning the whole budget on it.
      if (!isTransientRestartError(error)) throw error;
      lastError = error;
      await backoff();
    }
  }

  throw new Error(
    `Failed to restart VM ${vmid} after config update within ${Math.round(budgetMs / 1000)}s: ` +
      `${lastError?.message ?? "Proxmox stayed locked"}`,
  );
}

export async function resizeInstanceResources({ pve, waitForTask, token, node, vmid, target }) {
  const expected = validateTarget(target);
  const configPath = `nodes/${node}/qemu/${vmid}/config`;
  const before = await pve(token, "GET", configPath);
  const { disk, diskGb } = resolveBootDisk(before);
  if (expected.disk_gb < diskGb) throw new Error("disk shrinking is not supported");

  await pve(token, "PUT", configPath, {
    cores: expected.vcpu,
    memory: expected.memory_gb * 1024,
  });

  const growth = expected.disk_gb - diskGb;
  if (growth > 0) {
    const upid = requireTaskId(
      await pve(token, "PUT", `nodes/${node}/qemu/${vmid}/resize`, {
        disk,
        size: `+${growth}G`,
      }),
      "disk resize",
    );
    await waitForTask(token, node, upid);
  }

  const after = await pve(token, "GET", configPath);
  const observed = {
    vcpu: Number(after.cores),
    memory_gb: Number(after.memory) / 1024,
    disk_gb: parseDiskGiB(after[disk]),
    disk,
  };
  if (
    observed.vcpu !== expected.vcpu ||
    observed.memory_gb !== expected.memory_gb ||
    observed.disk_gb < expected.disk_gb
  ) {
    throw new Error("Proxmox resources did not match the requested resize target");
  }
  return observed;
}
