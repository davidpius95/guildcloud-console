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
