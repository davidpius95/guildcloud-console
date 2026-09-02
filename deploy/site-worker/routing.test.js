import assert from "node:assert/strict";
import test from "node:test";

import { assertOperationOwnership, buildCloneParams, executionTarget, resolveTemplate } from "./routing.js";

// --- assertOperationOwnership -----------------------------------------
//
// This is the fix for the cross-cluster deletion bug: the old worker
// selected every instance in state='deleting' with no cluster filter and
// issued DELETE against a hardcoded node. A guild-b deletion could make the
// guild-a worker delete whatever guild-a VM happened to hold that VMID.

test("assertOperationOwnership passes when the operation belongs to this worker's cluster", () => {
  assert.doesNotThrow(() => assertOperationOwnership({ cluster_id: "guild-a" }, "guild-a"));
});

test("assertOperationOwnership throws when the operation belongs to a different cluster", () => {
  assert.throws(
    () => assertOperationOwnership({ id: "op-1", cluster_id: "guild-b" }, "guild-a"),
    /guild-b.*guild-a|guild-a.*guild-b/,
  );
});

test("assertOperationOwnership throws when the operation has no cluster assigned yet", () => {
  assert.throws(() => assertOperationOwnership({ id: "op-1", cluster_id: null }, "guild-a"), /cluster_id/);
});

test("assertOperationOwnership works against an instance row too (same shape check)", () => {
  assert.doesNotThrow(() => assertOperationOwnership({ cluster_id: "guild-b" }, "guild-b"));
  assert.throws(() => assertOperationOwnership({ id: "inst-1", cluster_id: "guild-a" }, "guild-b"));
});

// --- executionTarget -----------------------------------------------------

test("executionTarget prefers the operation's assigned placement for a create", () => {
  const target = executionTarget(
    { kind: "instance.create", assigned_node: "podA", storage_id: "local-lvm" },
    { proxmox_node: null },
  );
  assert.deepEqual(target, { node: "podA", storageId: "local-lvm" });
});

test("executionTarget falls back to the instance's stored placement for lifecycle ops", () => {
  const target = executionTarget(
    { kind: "instance.resize", assigned_node: null, storage_id: null },
    { proxmox_node: "nodeD", storage_id: "ceph-vm" },
  );
  assert.deepEqual(target, { node: "nodeD", storageId: "ceph-vm" });
});

test("executionTarget throws rather than returning a null node", () => {
  assert.throws(
    () => executionTarget({ kind: "instance.resize", assigned_node: null }, { proxmox_node: null }),
    /node/,
  );
});

test("executionTarget tolerates a missing storage_id on lifecycle ops that don't need one", () => {
  const target = executionTarget(
    { kind: "instance.snapshot", assigned_node: null, storage_id: null },
    { proxmox_node: "podE", storage_id: null },
  );
  assert.equal(target.node, "podE");
  assert.equal(target.storageId, null);
});

// --- resolveTemplate -------------------------------------------------------

function templateRow(overrides = {}) {
  return {
    catalog_image_id: "ubuntu-2404",
    cluster_id: "guild-a",
    node: "nodeD",
    source_node: "nodeD",
    proxmox_vmid: 9020,
    storage_id: "ceph-vm",
    clone_mode: "linked",
    enabled: true,
    ...overrides,
  };
}

test("resolveTemplate finds the row matching image, cluster, and node", () => {
  const rows = [
    templateRow(),
    templateRow({ cluster_id: "guild-b", node: "podA", source_node: "podA", proxmox_vmid: 9101, storage_id: "local-lvm" }),
  ];

  const resolved = resolveTemplate(rows, { imageId: "ubuntu-2404", clusterId: "guild-b", node: "podA" });
  assert.equal(resolved.proxmox_vmid, 9101);
  assert.equal(resolved.source_node, "podA");
});

test("resolveTemplate throws template_not_resolvable_on_node rather than falling back to another node's template", () => {
  const rows = [templateRow({ cluster_id: "guild-b", node: "podA" })];

  assert.throws(
    () => resolveTemplate(rows, { imageId: "ubuntu-2404", clusterId: "guild-b", node: "podF" }),
    /template_not_resolvable_on_node/,
  );
});

test("resolveTemplate ignores a disabled row", () => {
  const rows = [templateRow({ enabled: false })];

  assert.throws(
    () => resolveTemplate(rows, { imageId: "ubuntu-2404", clusterId: "guild-a", node: "nodeD" }),
    /template_not_resolvable_on_node/,
  );
});

test("resolveTemplate never matches across clusters even with the same node name coincidentally reused", () => {
  const rows = [templateRow({ cluster_id: "guild-a", node: "shared-name" })];

  assert.throws(() =>
    resolveTemplate(rows, { imageId: "ubuntu-2404", clusterId: "guild-b", node: "shared-name" }),
  );
});

// --- buildCloneParams ------------------------------------------------------
//
// Regression cover for the ENOSPC failure: guild-b's linked clones inherited
// the template's shared NFS storage, filling the export that also holds the
// PBS datastore and the cloud-init snippets.

test("buildCloneParams sends the target storage for a full clone", () => {
  const params = buildCloneParams(
    templateRow({ cluster_id: "guild-b", node: "podF", source_node: "podA", clone_mode: "full", storage_id: "local-lvm" }),
    { newid: 130, name: "test", pool: "guildcloud", targetNode: "podF" },
  );

  assert.equal(params.full, 1);
  assert.equal(params.storage, "local-lvm");
  assert.equal(params.target, "podF");
});

test("buildCloneParams never sends storage for a linked clone, which Proxmox would reject", () => {
  const params = buildCloneParams(
    templateRow({ storage_id: "ceph-vm", clone_mode: "linked" }),
    { newid: 130, name: "test", pool: "guildcloud", targetNode: "nodeB" },
  );

  assert.equal(params.full, 0);
  assert.equal("storage" in params, false);
  assert.equal(params.target, "nodeB");
});

test("buildCloneParams sends target for a same-node full clone to node-local storage", () => {
  const params = buildCloneParams(
    templateRow({ source_node: "nodeD", clone_mode: "full", storage_id: "local-lvm" }),
    { newid: 130, name: "test", pool: "guildcloud", targetNode: "nodeD" },
  );

  assert.equal(params.target, "nodeD");
  assert.equal(params.storage, "local-lvm");
});

test("buildCloneParams omits target when a linked clone stays on the template's own node", () => {
  const params = buildCloneParams(
    templateRow({ source_node: "nodeD", clone_mode: "linked", storage_id: "ceph-vm" }),
    { newid: 130, name: "test", pool: "guildcloud", targetNode: "nodeD" },
  );

  assert.equal("target" in params, false);
  assert.equal("storage" in params, false);
});

test("the orphan sweep flags only pool guests the control plane cannot account for", async () => {
  const { findOrphanGuests } = await import("./routing.js");
  const orphans = findOrphanGuests({
    poolMembers: [
      { type: "qemu", vmid: 107, node: "podF", name: "yrt", status: "running", template: 0 },
      { type: "qemu", vmid: 110, node: "podF", name: "Trsy", status: "running", template: 0 },
      { type: "qemu", vmid: 119, node: "podF", name: "iiiuuu", status: "stopped", template: 0 },
      { type: "qemu", vmid: 121, node: "podF", name: "coolify", status: "stopped", template: 0 },
    ],
    knownVmids: [107, 110],
  });
  assert.deepEqual(orphans, [
    { vmid: 119, node: "podF", name: "iiiuuu", status: "stopped" },
    { vmid: 121, node: "podF", name: "coolify", status: "stopped" },
  ]);
});

test("the orphan sweep never proposes a template", async () => {
  const { findOrphanGuests } = await import("./routing.js");
  // Every instance is cloned from these; they are pool members and have no
  // instance row, so nothing but the template flag keeps them safe.
  assert.deepEqual(
    findOrphanGuests({
      poolMembers: [
        { type: "qemu", vmid: 9166, node: "podF", name: "ubuntu-2404-guildvm-template-podF", template: 1 },
        { type: "qemu", vmid: 9163, node: "podC", name: "ubuntu-2404-guildvm-template-podC", template: true },
      ],
      knownVmids: [],
    }),
    [],
  );
});

test("the orphan sweep never proposes the worker's own container", async () => {
  const { findOrphanGuests } = await import("./routing.js");
  // lxc/500 is a pool member with no instance row. Reaping it would destroy the
  // cluster's control loop, including whatever was doing the reaping.
  assert.deepEqual(
    findOrphanGuests({
      poolMembers: [
        { type: "lxc", vmid: 500, node: "podD", name: "guildcloud-site-worker-guild-b", template: 0 },
      ],
      knownVmids: [],
    }),
    [],
  );
});

test("the orphan sweep treats warm-pool guests as accounted for", async () => {
  const { findOrphanGuests } = await import("./routing.js");
  // Warm-pool VMs are real guests with no instance row. They reach the sweep
  // through knownVmids; without them every pass would propose reaping the pool.
  assert.deepEqual(
    findOrphanGuests({
      poolMembers: [{ type: "qemu", vmid: 140, node: "podB", name: "pool-140", template: 0 }],
      knownVmids: [140],
    }),
    [],
  );
});

test("the orphan sweep ignores a pool member with no usable vmid", async () => {
  const { findOrphanGuests } = await import("./routing.js");
  assert.deepEqual(
    findOrphanGuests({ poolMembers: [{ type: "qemu", node: "podF" }], knownVmids: [] }),
    [],
  );
  assert.deepEqual(findOrphanGuests({}), []);
});
