import assert from "node:assert/strict";
import test from "node:test";

import { assertOperationOwnership, executionTarget, resolveTemplate } from "./routing.js";

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
