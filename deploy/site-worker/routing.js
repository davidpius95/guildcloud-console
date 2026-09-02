// Cluster-ownership and placement-resolution guards.
//
// The old single-cluster worker filtered its main claim loop by site_id but
// left every housekeeping query (deletions, SSH key sync) unfiltered,
// trusting that only one cluster's rows could ever exist. Once a second
// cluster shares the same service-role key and the same VMID space
// (uniqueness is now per-cluster, not global), an unfiltered query can act
// on the wrong cluster's VM. assertOperationOwnership is the guard every
// Proxmox-touching call site must pass before it runs - it is the mechanical
// fix for that bug, not just documentation of it.

export function assertOperationOwnership(row, workerClusterId) {
  const clusterId = row?.cluster_id;
  if (!clusterId) {
    throw new Error(
      `Refusing to act on ${row?.id ?? "(unknown row)"}: it has no cluster_id assigned yet`,
    );
  }
  if (clusterId !== workerClusterId) {
    throw new Error(
      `Refusing to act on ${row?.id ?? "(unknown row)"}: it belongs to cluster ${JSON.stringify(
        clusterId,
      )}, this worker owns ${JSON.stringify(workerClusterId)}`,
    );
  }
}

// executionTarget(operation, instance) -> { node, storageId }
//
// Creates carry their placement on the operation (assigned_node/storage_id,
// written by place_next_pending_operation). Every other lifecycle kind reads
// the instance's own stored placement instead - that is what keeps a resize
// or delete on the cluster/node the instance actually lives on, independent
// of whatever placement_settings.mode is active right now. Throws rather
// than returning a null node, because a null node here means "clone/act
// against nothing," not "use some default."
export function executionTarget(operation, instance) {
  const node = operation?.assigned_node ?? instance?.proxmox_node ?? null;
  if (!node) {
    throw new Error(
      `Cannot determine an execution node for operation ${operation?.id ?? "(unknown)"}: neither the operation nor the instance has one assigned`,
    );
  }
  const storageId = operation?.storage_id ?? instance?.storage_id ?? null;
  return { node, storageId };
}

// resolveTemplate(rows, { imageId, clusterId, node }) -> a
// catalog_image_cluster_node_templates row.
//
// Guild-A's VM storage (ceph-vm) is shared, so one template on nodeD can be
// linked-cloned onto any node. Guild-B's local-lvm is per-node, so a
// template only exists on the node it was restored onto - cloning "the
// nearest template" instead of the one actually resolvable on the target
// node would either fail outright or (worse, on a cluster with a
// same-numbered VMID) clone the wrong image. This throws
// template_not_resolvable_on_node instead of silently degrading to another
// node's row.
export function resolveTemplate(rows, { imageId, clusterId, node }) {
  const match = rows.find(
    (row) =>
      row.enabled &&
      row.catalog_image_id === imageId &&
      row.cluster_id === clusterId &&
      row.node === node,
  );
  if (!match) {
    throw new Error(
      `template_not_resolvable_on_node: no enabled template for image ${JSON.stringify(
        imageId,
      )} on cluster ${JSON.stringify(clusterId)} node ${JSON.stringify(node)}`,
    );
  }
  return match;
}

// buildCloneParams(template, { newid, name, pool, targetNode }) -> params for
// POST /nodes/{source_node}/qemu/{vmid}/clone
//
// The `storage` parameter is the reason this exists. Proxmox only honours it
// for a FULL clone - a linked clone is pinned to the storage its base disk
// lives on, with no way to redirect it. Guild-B's template sits on the shared
// NFS export (guild-templates), so every linked clone landed its customer
// disk on that same 211 GB export, which is also where the PBS datastore and
// the cloud-init snippets live. It filled up, and instance creates started
// failing with ENOSPC while each node's own local-lvm sat at 0 bytes used.
//
// So: a template row asking for a storage different from its base must be
// clone_mode 'full', and we pass it through. Guild-A is unaffected - ceph-vm
// is shared cluster-wide, its templates stay linked, and a linked row simply
// never sets `storage`.
export function buildCloneParams(template, { newid, name, pool, targetNode }) {
  const full = template.clone_mode === "full";
  const params = { newid, name, pool, full: full ? 1 : 0 };
  if (full && template.storage_id) params.storage = template.storage_id;
  // Proxmox rejects full clones to node-local storage such as Guild-B's
  // local-lvm unless the destination node is explicit. That is true even
  // when the API path already points at the same node
  // (POST /nodes/podA/qemu/<template>/clone): without target=podA it returns
  // "can't clone to non-shared storage 'local-lvm'".
  if (template.source_node !== targetNode || (full && template.storage_id)) {
    params.target = targetNode;
  }
  return params;
}

// Which guests in a cluster's PVE pool the control plane cannot account for.
//
// The boundary is pool membership, not tags. Guild-B's nodes carry plenty of
// non-GuildCloud workloads, and at least one of them (`wazuh`, vmid 130) carries
// the `guildcloud` tag while belonging to no pool -- matching on tags would have
// proposed reaping it. Every GuildCloud clone is created into config.pvePoolId,
// so the pool is the platform's own record of what it made.
//
// Three things are excluded beyond the known set, and each has bitten or would
// have bitten something real:
//   * templates -- the per-node ubuntu-2404-guildvm-template-* guests live in
//     the pool and are what every instance is cloned from;
//   * anything that is not a QEMU guest -- the worker's own LXC is a pool
//     member, and reaping it would take the cluster's control loop with it;
//   * warm-pool VMs, which are real guests with no instance row. They come in
//     through knownVmids rather than being special-cased here.
export function findOrphanGuests({ poolMembers, knownVmids }) {
  const known = new Set((knownVmids ?? []).map(Number));
  return (poolMembers ?? [])
    .filter((member) => {
      if (member?.template === 1 || member?.template === true) return false;
      if (member?.type && member.type !== "qemu") return false;
      const vmid = Number(member?.vmid);
      if (!Number.isFinite(vmid)) return false;
      return !known.has(vmid);
    })
    .map((member) => ({
      vmid: Number(member.vmid),
      node: member.node,
      name: member.name ?? null,
      status: member.status ?? null,
    }));
}
