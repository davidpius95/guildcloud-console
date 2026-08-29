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

  // --- instance runtime -----------------------------------------------------

  // Only observed-from-infrastructure columns are accepted; the RPC rejects
  // anything else rather than ignoring it, so a typo fails loudly instead of
  // silently not persisting.
  updateInstanceRuntime(instanceId, patch) {
    return this.#rpc("worker_update_instance_runtime", {
      p_instance_id: instanceId,
      p_patch: patch,
    });
  }

  // --- housekeeping listings ------------------------------------------------

  listPendingDeletions() {
    return this.#rpc("worker_list_pending_deletions");
  }

  listPendingSshKeySyncs() {
    return this.#rpc("worker_list_pending_ssh_key_syncs");
  }

  // --- capacity -------------------------------------------------------------

  holdCapacity({ operationId, node, vcpu, memoryGb, diskGb, storageId, expiresAt }) {
    return this.#rpc("worker_hold_capacity", {
      p_operation_id: operationId,
      p_node: node,
      p_vcpu: vcpu,
      p_memory_gb: memoryGb,
      p_disk_gb: diskGb,
      p_storage_id: storageId,
      p_expires_at: expiresAt,
    });
  }

  releaseCapacity(operationId) {
    return this.#rpc("worker_release_capacity", { p_operation_id: operationId });
  }

  listHeldCapacity(node) {
    return this.#rpc("worker_list_held_capacity", { p_node: node });
  }

  // --- warm pool ------------------------------------------------------------

  listWarmPoolVms(states) {
    return this.#rpc("worker_list_warm_pool_vms", { p_states: states });
  }

  claimWarmPoolVm(instanceId, catalogImageId, catalogPlanId) {
    return this.#rpc("worker_claim_warm_pool_vm", {
      p_instance_id: instanceId,
      p_catalog_image_id: catalogImageId,
      p_catalog_plan_id: catalogPlanId,
    });
  }

  recordWarmPoolVm({ catalogImageId, catalogPlanId, proxmoxVmid, proxmoxNode, tailscaleHostname }) {
    return this.#rpc("worker_record_warm_pool_vm", {
      p_catalog_image_id: catalogImageId,
      p_catalog_plan_id: catalogPlanId,
      p_proxmox_vmid: proxmoxVmid,
      p_proxmox_node: proxmoxNode,
      p_tailscale_hostname: tailscaleHostname,
    });
  }

  updateWarmPoolVm(id, state, { tailscaleDeviceId = null, privateIp = null, failureReason = null } = {}) {
    return this.#rpc("worker_update_warm_pool_vm", {
      p_warm_pool_vm_id: id,
      p_state: state,
      p_tailscale_device_id: tailscaleDeviceId,
      p_private_ip: privateIp,
      p_failure_reason: failureReason,
    });
  }

  // --- catalog --------------------------------------------------------------

  getPlan(catalogPlanId) {
    return this.#rpc("worker_get_plan", { p_catalog_plan_id: catalogPlanId });
  }

  listNodeTemplates(catalogImageId, node) {
    return this.#rpc("worker_list_node_templates", {
      p_catalog_image_id: catalogImageId,
      p_node: node,
    });
  }

  // --- scoped reads ---------------------------------------------------------

  getInstance(instanceId) {
    return this.#rpc("worker_get_instance", { p_instance_id: instanceId });
  }

  listInstanceSshKeys(instanceId) {
    return this.#rpc("worker_list_instance_ssh_keys", { p_instance_id: instanceId });
  }

  getInstanceProject(instanceId) {
    return this.#rpc("worker_get_instance_project", { p_instance_id: instanceId });
  }

  // --- tailnet housekeeping -------------------------------------------------
  //
  // Tailnet-wide rather than cluster-scoped, and granted by
  // worker_identities.tailnet_housekeeping rather than by the worker's own env
  // file - so two workers cannot both believe they own the Tailscale policy and
  // race a read-modify-write of it.

  // Asks whether this worker holds the role, rather than discovering it by being
  // refused. Every cluster but one is not the housekeeper, so without this the
  // non-holders call getTailnetDesiredState every cycle and log the refusal.
  //
  // False means "valid worker, not the housekeeper". An unknown or revoked
  // worker raises rather than returning false, so this cannot be used to sidestep
  // a revocation.
  holdsTailnetHousekeeping() {
    return this.#rpc("worker_holds_tailnet_housekeeping");
  }

  getTailnetDesiredState() {
    return this.#rpc("worker_get_tailnet_desired_state");
  }

  markProjectAclApplied(projectId) {
    return this.#rpc("worker_mark_project_acl_applied", { p_project_id: projectId });
  }

  markMemberEnrolled(membershipId, tailscaleDeviceId) {
    return this.#rpc("worker_mark_member_enrolled", {
      p_membership_id: membershipId,
      p_tailscale_device_id: tailscaleDeviceId,
    });
  }
}
