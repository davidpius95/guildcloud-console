const ADMISSION_STATES = new Set(["open", "draining", "paused"]);
const FRESHNESS_WINDOW_MS = 60_000;

const BOOLEAN_FIELDS = [
  "clusterEnabled",
  "nodeEnabled",
  "nodeOnline",
  "storageEnabled",
  "storageHealthy",
  "templateEnabled",
  "templateTested",
  "privateNetworkingHealthy",
  "backupHealthy",
  "monitoringHealthy",
  "warmPoolMatch",
];

const CAPACITY_FIELDS = [
  "usedMemoryBytes",
  "committedMemoryBytes",
  "committedVcpu",
  "usedStorageBytes",
  "heldMemoryBytes",
  "heldVcpu",
  "heldStorageBytes",
];

const TOTAL_CAPACITY_FIELDS = [
  "totalMemoryBytes",
  "totalVcpu",
  "totalStorageBytes",
];

const TIMESTAMP_FIELDS = [
  "workerHeartbeatAt",
  "capacityObservedAt",
  "nodeObservedAt",
  "storageObservedAt",
];

function clampScoreInput(value) {
  return Math.min(1, Math.max(0, value));
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function assertFiniteInteger(value, field, { positive = false } = {}) {
  if (
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    (positive ? value <= 0 : value < 0)
  ) {
    throw new TypeError(`${field} must be a ${positive ? "positive" : "non-negative"} integer`);
  }
}

function parseTimestamp(value, field) {
  if (typeof value !== "string" && typeof value !== "number" && !(value instanceof Date)) {
    throw new TypeError(`${field} must be a string, Date, or number`);
  }

  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    throw new TypeError(`${field} must be a valid timestamp`);
  }

  return timestamp;
}

function validateRequest(request) {
  if (!request || typeof request !== "object") {
    throw new TypeError("request must be an object");
  }

  assertFiniteInteger(request.memoryBytes, "memoryBytes", { positive: true });
  assertFiniteInteger(request.vcpu, "vcpu", { positive: true });
  assertFiniteInteger(request.diskBytes, "diskBytes", { positive: true });
}

function validateCandidate(candidate) {
  if (!candidate || typeof candidate !== "object") {
    throw new TypeError("candidate must be an object");
  }

  for (const field of ["clusterId", "node", "storageId"]) {
    if (typeof candidate[field] !== "string") {
      throw new TypeError(`${field} must be a string`);
    }
  }

  for (const field of ["clusterAdmissionState", "nodeAdmissionState"]) {
    if (!ADMISSION_STATES.has(candidate[field])) {
      throw new TypeError(`${field} is invalid`);
    }
  }

  for (const field of BOOLEAN_FIELDS) {
    if (typeof candidate[field] !== "boolean") {
      throw new TypeError(`${field} must be boolean`);
    }
  }

  for (const field of TOTAL_CAPACITY_FIELDS) {
    assertFiniteInteger(candidate[field], field, { positive: true });
  }

  for (const field of CAPACITY_FIELDS) {
    assertFiniteInteger(candidate[field], field);
  }

  for (const field of TIMESTAMP_FIELDS) {
    parseTimestamp(candidate[field], field);
  }

  if (
    !Array.isArray(candidate.templateTargetNodes) ||
    !candidate.templateTargetNodes.every((node) => typeof node === "string")
  ) {
    throw new TypeError("templateTargetNodes must be an array of strings");
  }
}

function isFresh(value, now) {
  const age = now - parseTimestamp(value, "timestamp");
  return age >= 0 && age <= FRESHNESS_WINDOW_MS;
}

export function evaluateCandidate(candidate, request, now) {
  validateCandidate(candidate);
  validateRequest(request);
  const nowTimestamp = parseTimestamp(now, "now");
  const rejectionReasons = [];

  if (!candidate.clusterEnabled) rejectionReasons.push("cluster_disabled");
  if (candidate.clusterAdmissionState !== "open") {
    rejectionReasons.push("cluster_admission_closed");
  }
  if (!isFresh(candidate.workerHeartbeatAt, nowTimestamp)) {
    rejectionReasons.push("worker_heartbeat_stale");
  }
  if (!isFresh(candidate.capacityObservedAt, nowTimestamp)) {
    rejectionReasons.push("cluster_capacity_stale");
  }
  if (!candidate.nodeEnabled) rejectionReasons.push("node_disabled");
  if (candidate.nodeAdmissionState !== "open") {
    rejectionReasons.push("node_admission_closed");
  }
  if (!candidate.nodeOnline) rejectionReasons.push("node_offline");
  if (!isFresh(candidate.nodeObservedAt, nowTimestamp)) {
    rejectionReasons.push("node_observation_stale");
  }
  if (!candidate.templateEnabled || !candidate.templateTested) {
    rejectionReasons.push("template_unavailable");
  }
  if (!candidate.templateTargetNodes.includes(candidate.node)) {
    rejectionReasons.push("template_target_mismatch");
  }
  if (!candidate.storageEnabled) rejectionReasons.push("storage_disabled");
  if (!candidate.storageHealthy) rejectionReasons.push("storage_unhealthy");
  if (!isFresh(candidate.storageObservedAt, nowTimestamp)) {
    rejectionReasons.push("storage_observation_stale");
  }
  if (!candidate.privateNetworkingHealthy) {
    rejectionReasons.push("private_networking_unhealthy");
  }
  if (!candidate.backupHealthy) rejectionReasons.push("backup_unhealthy");
  if (!candidate.monitoringHealthy) rejectionReasons.push("monitoring_unhealthy");

  const memoryBaseline = Math.max(
    candidate.usedMemoryBytes,
    candidate.committedMemoryBytes,
  );
  const postFreeMemoryBytes =
    candidate.totalMemoryBytes -
    memoryBaseline -
    candidate.heldMemoryBytes -
    request.memoryBytes;
  const memoryHeadroomRatio = postFreeMemoryBytes / candidate.totalMemoryBytes;

  const vcpuCeiling = Math.floor((candidate.totalVcpu * 7) / 10);
  const postCommittedVcpu =
    candidate.committedVcpu + candidate.heldVcpu + request.vcpu;
  const postFreeVcpu = vcpuCeiling - postCommittedVcpu;
  const vcpuHeadroomRatio = vcpuCeiling === 0 ? 0 : postFreeVcpu / vcpuCeiling;

  const postFreeStorageBytes =
    candidate.totalStorageBytes -
    candidate.usedStorageBytes -
    candidate.heldStorageBytes -
    request.diskBytes;
  const storageHeadroomRatio =
    postFreeStorageBytes / candidate.totalStorageBytes;

  if (postFreeMemoryBytes * 10 < candidate.totalMemoryBytes * 3) {
    rejectionReasons.push("memory_reserve_exceeded");
  }
  if (postCommittedVcpu > vcpuCeiling) {
    rejectionReasons.push("vcpu_limit_exceeded");
  }
  if (postFreeStorageBytes * 10 < candidate.totalStorageBytes * 3) {
    rejectionReasons.push("storage_reserve_exceeded");
  }

  const score =
    0.5 * clampScoreInput(memoryHeadroomRatio) +
    0.25 * clampScoreInput(vcpuHeadroomRatio) +
    0.2 * clampScoreInput(storageHeadroomRatio) +
    0.05 * (candidate.warmPoolMatch ? 1 : 0);

  return {
    candidate,
    eligible: rejectionReasons.length === 0,
    rejectionReasons,
    metrics: {
      memoryBaseline,
      postFreeMemoryBytes,
      memoryHeadroomRatio,
      vcpuCeiling,
      postCommittedVcpu,
      postFreeVcpu,
      vcpuHeadroomRatio,
      postFreeStorageBytes,
      storageHeadroomRatio,
      warmPoolMatch: candidate.warmPoolMatch,
    },
    score,
  };
}

export function rankCandidates(candidates, request, now) {
  if (!Array.isArray(candidates)) {
    throw new TypeError("candidates must be an array");
  }

  validateRequest(request);
  parseTimestamp(now, "now");

  return candidates
    .map((candidate) => evaluateCandidate(candidate, request, now))
    .filter((result) => result.eligible)
    .sort((left, right) => {
      return (
        right.score - left.score ||
        compareStrings(left.candidate.clusterId, right.candidate.clusterId) ||
        compareStrings(left.candidate.node, right.candidate.node) ||
        compareStrings(left.candidate.storageId, right.candidate.storageId)
      );
    });
}
