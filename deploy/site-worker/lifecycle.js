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
