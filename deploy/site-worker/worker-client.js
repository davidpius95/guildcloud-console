// Cluster-scoped control-plane client (plan Task 7).
//
// This is the only module allowed to talk to the control plane on the worker's
// own authority. It calls the `worker_*` RPCs, which resolve the caller's
// cluster from `worker_identities` in the database rather than from anything the
// worker sends. Two consequences worth stating, because they are the point:
//
//   * The cluster is never a parameter here. A method that let the caller name a
//     cluster would re-open exactly the hole this boundary closes, so none does.
//   * A stolen worker token is scoped to one cluster and revocable with a single
//     UPDATE, unlike the service-role key it replaces.
//
// The token is minted once, offline, and only ever read by the worker; the
// worker never holds the JWT signing secret.

const WORKER_ROLE = "guildcloud_site_worker";

// PostgREST maps these to HTTP-ish codes; keep the mapping in one place so the
// caller can distinguish "not mine" from "control plane is unhealthy" without
// string-matching Postgres errors at every call site.
const NOT_FOUND = "P0002";
const NOT_AUTHORIZED = "28000";
const FORBIDDEN = "42501";

export class WorkerControlPlaneError extends Error {
  constructor(operation, cause) {
    super(`${operation} failed: ${cause?.message ?? String(cause)}`);
    this.name = "WorkerControlPlaneError";
    this.code = cause?.code ?? null;
    this.operation = operation;
  }

  // True when the control plane says this row is not ours. Callers should treat
  // it as "skip and continue", never as a transient error to retry: retrying a
  // cross-cluster rejection forever is how a misconfigured worker turns into a
  // hot loop against production.
  get isNotOurs() {
    return this.code === NOT_FOUND || this.code === FORBIDDEN;
  }

  get isIdentityRejected() {
    return this.code === NOT_AUTHORIZED;
  }
}

function decodeJwtPayload(token) {
  const parts = String(token).split(".");
  if (parts.length !== 3) throw new Error("worker token is not a JWT");
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new Error("worker token payload is not valid JSON");
  }
}

// Fails startup rather than at the first RPC. A worker whose token carries the
// wrong role would otherwise run as `anon` and fail every call with a confusing
// permission error hours later.
export function assertWorkerToken(token, { expectedWorkerId } = {}) {
  const payload = decodeJwtPayload(token);

  if (payload.role !== WORKER_ROLE) {
    throw new Error(
      `worker token must carry role "${WORKER_ROLE}", got ${JSON.stringify(payload.role ?? null)}`,
    );
  }
  if (!payload.worker_id || typeof payload.worker_id !== "string") {
    throw new Error("worker token must carry a worker_id claim");
  }
  if (expectedWorkerId && payload.worker_id !== expectedWorkerId) {
    throw new Error(
      `worker token worker_id ${JSON.stringify(payload.worker_id)} does not match ` +
        `configured WORKER_ID ${JSON.stringify(expectedWorkerId)}`,
    );
  }
  if (typeof payload.exp === "number") {
    const secondsRemaining = payload.exp - Math.floor(Date.now() / 1000);
    if (secondsRemaining <= 0) throw new Error("worker token has expired");
  }
  return payload;
}

// Seconds of validity left, or null for a non-expiring token. Surfaced by the
// health command so an expiring worker credential is visible before it stops
// the cluster, rather than as a 3am outage.
export function workerTokenLifetime(token, now = Date.now()) {
  const payload = decodeJwtPayload(token);
  if (typeof payload.exp !== "number") return null;
  return payload.exp - Math.floor(now / 1000);
}

export class WorkerControlPlane {
  #supabase;

  constructor(supabase) {
    this.#supabase = supabase;
  }

  async #rpc(name, args = undefined) {
    const { data, error } = await this.#supabase.rpc(name, args);
    if (error) throw new WorkerControlPlaneError(name, error);
    return data;
  }

  heartbeat() {
    return this.#rpc("worker_heartbeat");
  }

  publishSnapshot(snapshot) {
    return this.#rpc("worker_publish_snapshot", { p_snapshot: snapshot });
  }

  // Returns the claimed operation id, or null when this cluster has no pending
  // work. Note there is no force-cluster escape hatch by design.
  claimNextOperation() {
    return this.#rpc("worker_claim_next_operation");
  }

  // Returns { operation, instance, stages }. Raises isNotOurs when the operation
  // belongs to another cluster.
  getOperation(operationId) {
    return this.#rpc("worker_get_operation", { p_operation_id: operationId });
  }

  startStage(operationId, stage) {
    return this.#rpc("worker_start_stage", {
      p_operation_id: operationId,
      p_stage: stage,
    });
  }

  completeStage(operationId, stage, status, detail = null, error = null) {
    return this.#rpc("worker_complete_stage", {
      p_operation_id: operationId,
      p_stage: stage,
      p_status: status,
      p_detail: detail,
      p_error: error,
    });
  }

  finishOperation(operationId, outcome, observed = null, error = null) {
    return this.#rpc("worker_finish_operation", {
      p_operation_id: operationId,
      p_outcome: outcome,
      p_observed: observed,
      p_error: error,
    });
  }
}
