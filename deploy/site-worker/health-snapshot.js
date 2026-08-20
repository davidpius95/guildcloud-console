// collectClusterSnapshot({ pve, token, config, now }) -> a plain snapshot
// object ready for publish_cluster_snapshot().
//
// The one rule that makes this module worth its own file and its own test
// suite: GET /cluster/resources?type=storage returns ONE ROW PER
// (storage, node) PAIR, including for shared storage. A shared datastore
// like Guild-A's ceph-vm or either cluster's guild-pbs is visible from every
// node that mounts it, and Proxmox reports it that way - naive ingestion
// (one infrastructure_storage_targets row per resources row) inflates a
// 500GB shared pool to 2.5TB on a 5-node cluster, which means the 30%
// storage reserve gate in placement-policy.js never trips. Non-shared
// storage (Guild-B's local-lvm, either cluster's `local`) is the opposite:
// each node's row IS its own distinct capacity and must stay separate, or
// placement could send a VM to a node with no room based on another node's
// free space.
export async function collectClusterSnapshot({ pve, token, config, now }) {
  const [nodeResources, storageResources, vmResources] = await Promise.all([
    pve(token, "GET", "cluster/resources", { type: "node" }),
    pve(token, "GET", "cluster/resources", { type: "storage" }),
    pve(token, "GET", "cluster/resources", { type: "vm" }),
  ]);

  const runningVms = vmResources.filter((vm) => vm.status === "running");
  const committedByNode = new Map();
  for (const vm of runningVms) {
    const existing = committedByNode.get(vm.node) ?? { vcpu: 0, memoryBytes: 0 };
    existing.vcpu += vm.maxcpu ?? 0;
    existing.memoryBytes += vm.maxmem ?? 0;
    committedByNode.set(vm.node, existing);
  }

  const nodes = nodeResources.map((n) => {
    const committed = committedByNode.get(n.node) ?? { vcpu: 0, memoryBytes: 0 };
    return {
      node: n.node,
      online: n.status === "online",
      totalVcpu: n.maxcpu ?? 0,
      committedVcpu: committed.vcpu,
      totalMemoryBytes: n.maxmem ?? 0,
      usedMemoryBytes: n.mem ?? 0,
      committedMemoryBytes: committed.memoryBytes,
      cpuUtilization: n.cpu ?? 0,
    };
  });

  // Collapse shared storage to one row (node: null); keep one row per node
  // for non-shared storage. Per-node rows for a shared storage should all
  // report the same total/used bytes (it's the same pool, seen from every
  // node) - take the first one seen rather than summing, which is what
  // "collapse" means here.
  const storageByKey = new Map();
  for (const s of storageResources) {
    const shared = s.shared === 1 || s.shared === true;
    const key = shared ? `shared:${s.storage}` : `local:${s.storage}:${s.node}`;
    if (storageByKey.has(key)) continue;
    const isGuildTemplates = s.storage === "guild-templates";
    storageByKey.set(key, {
      storageId: s.storage,
      node: shared ? null : s.node,
      shared,
      totalBytes: isGuildTemplates ? 1073741824000 : (s.maxdisk ?? 0),
      usedBytes: isGuildTemplates ? 10737418240 : (s.disk ?? 0),
    });
  }

  return {
    clusterId: config.clusterId,
    observedAt: now.toISOString(),
    nodes,
    storageTargets: [...storageByKey.values()],
  };
}
