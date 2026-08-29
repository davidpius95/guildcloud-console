import assert from "node:assert/strict";
import test from "node:test";

test("lifecycle module exposes the Proxmox correctness boundary", async () => {
  const lifecycle = await import("./lifecycle.js");
  assert.equal(typeof lifecycle.createSnapshot, "function");
  assert.equal(typeof lifecycle.rollbackSnapshot, "function");
  assert.equal(typeof lifecycle.resizeInstanceResources, "function");
});

test("snapshot becomes successful only after its UPID and observed snapshot complete", async () => {
  const { createSnapshot } = await import("./lifecycle.js");
  const events = [];
  const pve = async (_token, method, path, body) => {
    events.push({ method, path, body });
    if (method === "POST") return "UPID:nodeA:0001";
    return [{ name: "snap-release" }];
  };
  const waitForTask = async (_token, node, upid) => {
    events.push({ method: "WAIT", node, upid });
  };

  const observed = await createSnapshot({
    pve,
    waitForTask,
    token: "redacted-token",
    node: "nodeA",
    vmid: 101,
    snapname: "snap-release",
  });

  assert.deepEqual(observed, { proxmox_task_id: "UPID:nodeA:0001", snapshot: "snap-release" });
  assert.deepEqual(events.map((event) => event.method), ["POST", "WAIT", "GET"]);
});

test("snapshot rejects a Proxmox response without a task id", async () => {
  const { createSnapshot } = await import("./lifecycle.js");
  await assert.rejects(
    createSnapshot({
      pve: async () => null,
      waitForTask: async () => undefined,
      token: "redacted-token",
      node: "nodeA",
      vmid: 101,
      snapname: "snap-release",
    }),
    /did not return a task id/,
  );
});

test("restore rejects an empty snapshot instead of rebooting as a successful no-op", async () => {
  const { rollbackSnapshot } = await import("./lifecycle.js");
  await assert.rejects(
    rollbackSnapshot({
      pve: async () => "UPID:unexpected",
      waitForTask: async () => undefined,
      token: "redacted-token",
      node: "nodeA",
      vmid: 101,
      snapname: "",
    }),
    /snapshot name is required/,
  );
});

test("restore waits for the rollback task before reporting observed completion", async () => {
  const { rollbackSnapshot } = await import("./lifecycle.js");
  const events = [];
  const observed = await rollbackSnapshot({
    pve: async (_token, method, path) => {
      events.push({ method, path });
      return "UPID:nodeA:rollback";
    },
    waitForTask: async (_token, node, upid) => {
      events.push({ method: "WAIT", node, upid });
    },
    token: "redacted-token",
    node: "nodeA",
    vmid: 101,
    snapname: "snap-release",
  });

  assert.deepEqual(observed, { proxmox_task_id: "UPID:nodeA:rollback", snapshot: "snap-release" });
  assert.deepEqual(events.map((event) => event.method), ["POST", "WAIT"]);
});

function statefulResizePve({ diskKey = "scsi0", diskGb = 40, failDisk = false } = {}) {
  const state = { cores: 1, memory: 2048, diskGb };
  const calls = [];
  const pve = async (_token, method, path, body) => {
    calls.push({ method, path, body });
    if (method === "GET") {
      return {
        cores: state.cores,
        memory: state.memory,
        boot: `order=${diskKey};ide2;net0`,
        [diskKey]: `local-lvm:vm-101-disk-0,size=${state.diskGb}G`,
      };
    }
    if (path.endsWith("/config")) {
      state.cores = body.cores;
      state.memory = body.memory;
      return null;
    }
    if (path.endsWith("/resize")) {
      if (failDisk) throw new Error("disk resize failed");
      state.diskGb += Number(String(body.size).replace(/^\+/, "").replace(/G$/, ""));
      return "UPID:nodeA:resize";
    }
    throw new Error(`Unexpected request ${method} ${path}`);
  };
  return { pve, calls };
}

test("resize grows the observed boot disk and publishes verified target resources", async () => {
  const { resizeInstanceResources } = await import("./lifecycle.js");
  const fake = statefulResizePve();
  const waits = [];

  const observed = await resizeInstanceResources({
    pve: fake.pve,
    waitForTask: async (_token, node, upid) => waits.push({ node, upid }),
    token: "redacted-token",
    node: "nodeA",
    vmid: 101,
    target: { vcpu: 2, memory_gb: 4, disk_gb: 80 },
  });

  assert.deepEqual(observed, { vcpu: 2, memory_gb: 4, disk_gb: 80, disk: "scsi0" });
  assert.deepEqual(waits, [{ node: "nodeA", upid: "UPID:nodeA:resize" }]);
  assert.equal(fake.calls.find((call) => call.path.endsWith("/resize")).body.size, "+40G");
});

test("resize resolves a non-scsi boot disk from observed configuration", async () => {
  const { resizeInstanceResources } = await import("./lifecycle.js");
  const fake = statefulResizePve({ diskKey: "virtio0" });

  const observed = await resizeInstanceResources({
    pve: fake.pve,
    waitForTask: async () => undefined,
    token: "redacted-token",
    node: "nodeA",
    vmid: 101,
    target: { vcpu: 2, memory_gb: 4, disk_gb: 80 },
  });

  assert.equal(observed.disk, "virtio0");
});

test("resize refuses any disk shrink before changing Proxmox", async () => {
  const { resizeInstanceResources } = await import("./lifecycle.js");
  const fake = statefulResizePve({ diskGb: 80 });

  await assert.rejects(
    resizeInstanceResources({
      pve: fake.pve,
      waitForTask: async () => undefined,
      token: "redacted-token",
      node: "nodeA",
      vmid: 101,
      target: { vcpu: 2, memory_gb: 4, disk_gb: 40 },
    }),
    /disk shrinking is not supported/,
  );
  assert.equal(fake.calls.filter((call) => call.method === "PUT").length, 0);
});

test("resize never reports success after a partial disk failure", async () => {
  const { resizeInstanceResources } = await import("./lifecycle.js");
  const fake = statefulResizePve({ failDisk: true });

  await assert.rejects(
    resizeInstanceResources({
      pve: fake.pve,
      waitForTask: async () => undefined,
      token: "redacted-token",
      node: "nodeA",
      vmid: 101,
      target: { vcpu: 2, memory_gb: 4, disk_gb: 80 },
    }),
    /disk resize failed/,
  );
});
