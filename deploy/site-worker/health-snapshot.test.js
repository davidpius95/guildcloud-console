import assert from "node:assert/strict";
import test from "node:test";

import { collectClusterSnapshot } from "./health-snapshot.js";

const NOW = new Date("2026-08-19T12:00:00.000Z");

// Fixtures captured verbatim (shape, not values) from GET /cluster/resources
// against both live clusters. The correctness this file exists to protect:
// that endpoint returns one row per (storage, node) pair EVEN for shared
// storage - naive ingestion double(or 5x/6x)-counts a shared datastore's
// capacity once per node that can see it.

function guildAResources() {
  return [
    { type: "node", node: "nodeA", status: "online", maxcpu: 4, maxmem: 16649015296, mem: 8620638208 },
    { type: "node", node: "nodeB", status: "online", maxcpu: 4, maxmem: 16649187328, mem: 6362189824 },
    { type: "node", node: "nodeC", status: "online", maxcpu: 4, maxmem: 8205840384, mem: 5673000960 },
    { type: "node", node: "nodeD", status: "online", maxcpu: 4, maxmem: 16648900608, mem: 12874240000 },
    { type: "node", node: "nodeE", status: "online", maxcpu: 4, maxmem: 16649117696, mem: 9813389312 },
    // ceph-vm is shared: PVE reports it once per node that mounts it.
    { type: "storage", storage: "ceph-vm", node: "nodeA", shared: 1, maxdisk: 500_000_000_000, disk: 100_000_000_000 },
    { type: "storage", storage: "ceph-vm", node: "nodeB", shared: 1, maxdisk: 500_000_000_000, disk: 100_000_000_000 },
    { type: "storage", storage: "ceph-vm", node: "nodeC", shared: 1, maxdisk: 500_000_000_000, disk: 100_000_000_000 },
    { type: "storage", storage: "ceph-vm", node: "nodeD", shared: 1, maxdisk: 500_000_000_000, disk: 100_000_000_000 },
    { type: "storage", storage: "ceph-vm", node: "nodeE", shared: 1, maxdisk: 500_000_000_000, disk: 100_000_000_000 },
    { type: "storage", storage: "local", node: "nodeD", shared: 0, maxdisk: 72722055168, disk: 11876524032 },
    { type: "qemu", node: "nodeD", vmid: 119429, status: "running", maxcpu: 1, maxmem: 2147483648 },
  ];
}

function guildBResources() {
  return [
    { type: "node", node: "podA", status: "online", maxcpu: 22, maxmem: 66696531968, mem: 16792436736 },
    { type: "node", node: "podB", status: "online", maxcpu: 6, maxmem: 33440935936, mem: 20643172352 },
    // local-lvm is per-node, NOT shared: each node's row is its own capacity.
    { type: "storage", storage: "local-lvm", node: "podA", shared: 0, maxdisk: 3836471148544, disk: 108188486388 },
    { type: "storage", storage: "local-lvm", node: "podB", shared: 0, maxdisk: 1836111101952, disk: 43148610895 },
    { type: "storage", storage: "guild-pbs", node: "podA", shared: 1, maxdisk: 0, disk: 0, status: "unknown" },
    { type: "storage", storage: "guild-pbs", node: "podB", shared: 1, maxdisk: 0, disk: 0, status: "unknown" },
    { type: "qemu", node: "podA", vmid: 100, status: "running", maxcpu: 8, maxmem: 8589934592 },
  ];
}

function fakePve(resources, { vmConfigs = {} } = {}) {
  return async (_token, method, pathStr, params) => {
    if (method === "GET" && pathStr === "cluster/resources" && !params?.type) return resources;
    if (method === "GET" && pathStr === "cluster/resources" && params.type === "node") {
      return resources.filter((r) => r.type === "node");
    }
    if (method === "GET" && pathStr === "cluster/resources" && params.type === "storage") {
      return resources.filter((r) => r.type === "storage");
    }
    if (method === "GET" && pathStr === "cluster/resources" && params.type === "vm") {
      return resources.filter((r) => r.type === "qemu" || r.type === "lxc");
    }
    const configMatch = pathStr.match(/^nodes\/[^/]+\/qemu\/(\d+)\/config$/);
    if (method === "GET" && configMatch) {
      return vmConfigs[configMatch[1]] ?? { cores: 1, memory: 512 };
    }
    throw new Error(`fakePve: unhandled call ${method} ${pathStr}`);
  };
}

test("collapses a shared storage to a single node=null row instead of once per node", async () => {
  const snapshot = await collectClusterSnapshot({
    pve: fakePve(guildAResources()),
    token: "tok",
    config: { clusterId: "guild-a" },
    now: NOW,
  });

  const ceph = snapshot.storageTargets.filter((s) => s.storageId === "ceph-vm");
  assert.equal(ceph.length, 1, "ceph-vm must appear exactly once, not once per node");
  assert.equal(ceph[0].node, null);
  assert.equal(ceph[0].shared, true);
  assert.equal(ceph[0].totalBytes, 500_000_000_000);
  assert.equal(ceph[0].usedBytes, 100_000_000_000);
});

test("keeps one row per node for non-shared storage", async () => {
  const snapshot = await collectClusterSnapshot({
    pve: fakePve(guildBResources()),
    token: "tok",
    config: { clusterId: "guild-b" },
    now: NOW,
  });

  const localLvm = snapshot.storageTargets.filter((s) => s.storageId === "local-lvm");
  assert.equal(localLvm.length, 2);
  const podA = localLvm.find((s) => s.node === "podA");
  const podB = localLvm.find((s) => s.node === "podB");
  assert.equal(podA.shared, false);
  assert.equal(podA.totalBytes, 3836471148544);
  assert.equal(podB.totalBytes, 1836111101952);
  assert.notEqual(podA.totalBytes, podB.totalBytes, "each node keeps its own distinct capacity");
});

test("collapses a shared storage on guild-b too (guild-pbs)", async () => {
  const snapshot = await collectClusterSnapshot({
    pve: fakePve(guildBResources()),
    token: "tok",
    config: { clusterId: "guild-b" },
    now: NOW,
  });

  const pbs = snapshot.storageTargets.filter((s) => s.storageId === "guild-pbs");
  assert.equal(pbs.length, 1);
  assert.equal(pbs[0].node, null);
});

test("reports node capacity and online status from cluster/resources", async () => {
  const snapshot = await collectClusterSnapshot({
    pve: fakePve(guildAResources()),
    token: "tok",
    config: { clusterId: "guild-a" },
    now: NOW,
  });

  assert.equal(snapshot.nodes.length, 5);
  const nodeD = snapshot.nodes.find((n) => n.node === "nodeD");
  assert.equal(nodeD.online, true);
  assert.equal(nodeD.totalVcpu, 4);
  assert.equal(nodeD.totalMemoryBytes, 16648900608);
  assert.equal(nodeD.usedMemoryBytes, 12874240000);
});

test("marks an offline node instead of dropping it", async () => {
  const resources = guildAResources().map((r) =>
    r.type === "node" && r.node === "nodeE" ? { ...r, status: "offline" } : r,
  );
  const snapshot = await collectClusterSnapshot({
    pve: fakePve(resources),
    token: "tok",
    config: { clusterId: "guild-a" },
    now: NOW,
  });

  const nodeE = snapshot.nodes.find((n) => n.node === "nodeE");
  assert.ok(nodeE, "an offline node must still be reported, not silently dropped");
  assert.equal(nodeE.online, false);
});

test("sums committed vcpu and memory from running VMs per node", async () => {
  const resources = [
    ...guildAResources(),
    { type: "qemu", node: "nodeD", vmid: 254234, status: "running", maxcpu: 2, maxmem: 4294967296 },
  ];
  const snapshot = await collectClusterSnapshot({
    pve: fakePve(resources),
    token: "tok",
    config: { clusterId: "guild-a" },
    now: NOW,
  });

  const nodeD = snapshot.nodes.find((n) => n.node === "nodeD");
  // 119429 (1 vcpu, 2GiB) + 254234 (2 vcpu, 4GiB), both running.
  assert.equal(nodeD.committedVcpu, 3);
  assert.equal(nodeD.committedMemoryBytes, 2147483648 + 4294967296);
});

test("excludes stopped VMs from committed capacity", async () => {
  const resources = [
    ...guildAResources(),
    { type: "qemu", node: "nodeD", vmid: 210, status: "stopped", maxcpu: 8, maxmem: 8589934592 },
  ];
  const snapshot = await collectClusterSnapshot({
    pve: fakePve(resources),
    token: "tok",
    config: { clusterId: "guild-a" },
    now: NOW,
  });

  const nodeD = snapshot.nodes.find((n) => n.node === "nodeD");
  // Only 119429 (running) counts; the added stopped VM (210) does not.
  assert.equal(nodeD.committedVcpu, 1);
});

test("throws on a truncated response instead of publishing a partial snapshot", async () => {
  const brokenPve = async (_token, method, pathStr) => {
    if (pathStr === "cluster/resources") throw new Error("fetch failed: ECONNRESET");
    throw new Error(`unexpected call ${method} ${pathStr}`);
  };

  await assert.rejects(
    () => collectClusterSnapshot({ pve: brokenPve, token: "tok", config: { clusterId: "guild-a" }, now: NOW }),
    /ECONNRESET/,
  );
});

test("stamps every snapshot with the calling cluster id and a timestamp", async () => {
  const snapshot = await collectClusterSnapshot({
    pve: fakePve(guildAResources()),
    token: "tok",
    config: { clusterId: "guild-a" },
    now: NOW,
  });

  assert.equal(snapshot.clusterId, "guild-a");
  assert.equal(snapshot.observedAt, NOW.toISOString());
});
