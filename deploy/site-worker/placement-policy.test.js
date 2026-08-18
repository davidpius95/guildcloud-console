import assert from "node:assert/strict";
import test from "node:test";

import { evaluateCandidate, rankCandidates } from "./placement-policy.js";

const NOW = "2026-08-18T12:00:00.000Z";

function candidate(overrides = {}) {
  return {
    clusterId: "guild-a",
    node: "nodeA",
    storageId: "ceph",
    clusterEnabled: true,
    clusterAdmissionState: "open",
    workerHeartbeatAt: NOW,
    capacityObservedAt: NOW,
    nodeEnabled: true,
    nodeAdmissionState: "open",
    nodeOnline: true,
    nodeObservedAt: NOW,
    totalMemoryBytes: 10_000,
    usedMemoryBytes: 2_000,
    committedMemoryBytes: 3_000,
    totalVcpu: 10,
    committedVcpu: 2,
    storageEnabled: true,
    storageHealthy: true,
    storageObservedAt: NOW,
    totalStorageBytes: 100_000,
    usedStorageBytes: 20_000,
    heldMemoryBytes: 0,
    heldVcpu: 0,
    heldStorageBytes: 0,
    templateEnabled: true,
    templateTested: true,
    templateTargetNodes: ["nodeA"],
    privateNetworkingHealthy: true,
    backupHealthy: true,
    monitoringHealthy: true,
    warmPoolMatch: false,
    ...overrides,
  };
}

const REQUEST = {
  memoryBytes: 1_000,
  vcpu: 1,
  diskBytes: 10_000,
};

function reasons(overrides) {
  return evaluateCandidate(candidate(overrides), REQUEST, NOW).rejectionReasons;
}

test("rejects a stale worker heartbeat", () => {
  assert.deepEqual(reasons({ workerHeartbeatAt: "2026-08-18T11:58:59.999Z" }), [
    "worker_heartbeat_stale",
  ]);
});

test("rejects stale cluster capacity observations", () => {
  assert.deepEqual(reasons({ capacityObservedAt: "2026-08-18T11:58:59.999Z" }), [
    "cluster_capacity_stale",
  ]);
});

test("rejects stale node observations", () => {
  assert.deepEqual(reasons({ nodeObservedAt: "2026-08-18T11:58:59.999Z" }), [
    "node_observation_stale",
  ]);
});

test("rejects stale storage observations", () => {
  assert.deepEqual(reasons({ storageObservedAt: "2026-08-18T11:58:59.999Z" }), [
    "storage_observation_stale",
  ]);
});

test("rejects a disabled cluster and closed cluster admission", () => {
  assert.deepEqual(
    reasons({ clusterEnabled: false, clusterAdmissionState: "paused" }),
    ["cluster_disabled", "cluster_admission_closed"],
  );
});

test("rejects a disabled node and closed node admission", () => {
  assert.deepEqual(
    reasons({ nodeEnabled: false, nodeAdmissionState: "draining" }),
    ["node_disabled", "node_admission_closed"],
  );
});

test("rejects an offline node", () => {
  assert.deepEqual(reasons({ nodeOnline: false }), ["node_offline"]);
});

test("rejects a missing or disabled template capability", () => {
  assert.deepEqual(reasons({ templateEnabled: false, templateTested: false }), [
    "template_unavailable",
  ]);
});

test("rejects a template that does not target the node", () => {
  assert.deepEqual(reasons({ templateTargetNodes: ["nodeB"] }), [
    "template_target_mismatch",
  ]);
});

test("rejects disabled and unhealthy storage", () => {
  assert.deepEqual(
    reasons({ storageEnabled: false, storageHealthy: false }),
    ["storage_disabled", "storage_unhealthy"],
  );
});

test("rejects disabled prerequisites in contract order", () => {
  assert.deepEqual(
    reasons({
      privateNetworkingHealthy: false,
      backupHealthy: false,
      monitoringHealthy: false,
    }),
    [
      "private_networking_unhealthy",
      "backup_unhealthy",
      "monitoring_unhealthy",
    ],
  );
});

test("rejects a future timestamp through its corresponding freshness gate", () => {
  assert.deepEqual(reasons({ nodeObservedAt: "2026-08-18T12:00:00.001Z" }), [
    "node_observation_stale",
  ]);
});

test("accepts a timestamp exactly 60 seconds old", () => {
  const result = evaluateCandidate(
    candidate({
      workerHeartbeatAt: "2026-08-18T11:59:00.000Z",
      capacityObservedAt: "2026-08-18T11:59:00.000Z",
      nodeObservedAt: "2026-08-18T11:59:00.000Z",
      storageObservedAt: "2026-08-18T11:59:00.000Z",
    }),
    REQUEST,
    NOW,
  );

  assert.equal(result.eligible, true);
});

test("throws TypeError for invalid request values", () => {
  assert.throws(
    () => evaluateCandidate(candidate(), { ...REQUEST, vcpu: 0 }, NOW),
    TypeError,
  );
});

test("throws TypeError for invalid candidate capacity fields", () => {
  assert.throws(
    () => evaluateCandidate(candidate({ heldVcpu: 0.5 }), REQUEST, NOW),
    TypeError,
  );
});

test("requires the 30 percent memory reserve after placement", () => {
  const result = evaluateCandidate(
    candidate({ totalMemoryBytes: 10_000, usedMemoryBytes: 2_000, committedMemoryBytes: 2_000 }),
    { ...REQUEST, memoryBytes: 5_001 },
    NOW,
  );

  assert.deepEqual(result.rejectionReasons, ["memory_reserve_exceeded"]);
});

test("requires the 30 percent storage reserve after placement", () => {
  const result = evaluateCandidate(
    candidate(),
    { ...REQUEST, diskBytes: 50_001 },
    NOW,
  );

  assert.deepEqual(result.rejectionReasons, ["storage_reserve_exceeded"]);
});

test("caps committed vCPU at 70 percent of total vCPU", () => {
  const result = evaluateCandidate(
    candidate({ totalVcpu: 10, committedVcpu: 2 }),
    { ...REQUEST, vcpu: 6 },
    NOW,
  );

  assert.deepEqual(result.rejectionReasons, ["vcpu_limit_exceeded"]);
});

test("includes held memory, vCPU, and storage reservations", () => {
  const result = evaluateCandidate(
    candidate({
      heldMemoryBytes: 5_000,
      heldVcpu: 5,
      heldStorageBytes: 70_000,
    }),
    REQUEST,
    NOW,
  );

  assert.deepEqual(result.rejectionReasons, [
    "memory_reserve_exceeded",
    "vcpu_limit_exceeded",
    "storage_reserve_exceeded",
  ]);
});

test("uses committed memory when it exceeds observed memory", () => {
  const result = evaluateCandidate(
    candidate({ usedMemoryBytes: 1_000, committedMemoryBytes: 7_000 }),
    REQUEST,
    NOW,
  );

  assert.equal(result.eligible, false);
  assert.deepEqual(result.rejectionReasons, ["memory_reserve_exceeded"]);
  assert.equal(result.metrics.memoryBaseline, 7_000);
});

test("returns exact integer capacity metrics for an eligible candidate", () => {
  const result = evaluateCandidate(
    candidate({
      totalMemoryBytes: 10_000,
      usedMemoryBytes: 2_000,
      committedMemoryBytes: 4_000,
      heldMemoryBytes: 500,
      totalVcpu: 10,
      committedVcpu: 2,
      heldVcpu: 1,
      totalStorageBytes: 100_000,
      usedStorageBytes: 20_000,
      heldStorageBytes: 10_000,
    }),
    REQUEST,
    NOW,
  );

  assert.equal(result.eligible, true);
  assert.deepEqual(result.metrics, {
    memoryBaseline: 4_000,
    postFreeMemoryBytes: 4_500,
    memoryHeadroomRatio: 0.45,
    vcpuCeiling: 7,
    postCommittedVcpu: 4,
    postFreeVcpu: 3,
    vcpuHeadroomRatio: 3 / 7,
    postFreeStorageBytes: 60_000,
    storageHeadroomRatio: 0.6,
    warmPoolMatch: false,
  });
});

test("scores eligible candidates with the contract weights", () => {
  const result = evaluateCandidate(
    candidate({
      totalMemoryBytes: 1_000,
      usedMemoryBytes: 300,
      committedMemoryBytes: 300,
      totalVcpu: 10,
      committedVcpu: 2,
      totalStorageBytes: 10_000,
      usedStorageBytes: 3_000,
    }),
    { memoryBytes: 100, vcpu: 1, diskBytes: 1_000 },
    NOW,
  );

  const expected = 0.5 * 0.6 + 0.25 * (4 / 7) + 0.2 * 0.6;
  assert.ok(Math.abs(result.score - expected) < 1e-12);
});

test("adds a five percent warm-pool score bonus", () => {
  const cold = evaluateCandidate(candidate({ warmPoolMatch: false }), REQUEST, NOW);
  const warm = evaluateCandidate(candidate({ warmPoolMatch: true }), REQUEST, NOW);

  assert.ok(Math.abs(warm.score - cold.score - 0.05) < 1e-12);
});

test("clamps negative score inputs without overriding hard gates", () => {
  const result = evaluateCandidate(
    candidate({
      usedMemoryBytes: 9_000,
      committedMemoryBytes: 9_000,
      committedVcpu: 10,
      usedStorageBytes: 100_000,
      warmPoolMatch: true,
    }),
    REQUEST,
    NOW,
  );

  assert.equal(result.eligible, false);
  assert.equal(result.score, 0.05);
});

test("ranks eligible candidates by score and deterministic identity", () => {
  const candidates = [
    candidate({
      clusterId: "guild-b",
      node: "nodeA",
      storageId: "storage-a",
    }),
    candidate({
      clusterId: "guild-a",
      node: "nodeB",
      storageId: "storage-z",
      templateTargetNodes: ["nodeB"],
    }),
    candidate({
      clusterId: "guild-a",
      node: "nodeB",
      storageId: "storage-a",
      templateTargetNodes: ["nodeB"],
    }),
    candidate({
      clusterId: "guild-a",
      node: "nodeA",
      storageId: "storage-z",
    }),
    candidate({
      clusterId: "guild-a",
      node: "nodeC",
      storageId: "storage-a",
      nodeOnline: false,
      templateTargetNodes: ["nodeC"],
    }),
  ];

  const ranked = rankCandidates(candidates, REQUEST, NOW);

  assert.deepEqual(
    ranked.map(({ candidate: item }) => [item.clusterId, item.node, item.storageId]),
    [
      ["guild-a", "nodeA", "storage-z"],
      ["guild-a", "nodeB", "storage-a"],
      ["guild-a", "nodeB", "storage-z"],
      ["guild-b", "nodeA", "storage-a"],
    ],
  );
  assert.ok(ranked.every((result) => result.eligible));
});

test("requires rankCandidates input to be an array", () => {
  assert.throws(() => rankCandidates({}, REQUEST, NOW), TypeError);
});
