import assert from "node:assert/strict";
import test from "node:test";

import {
  WorkerControlPlane,
  WorkerControlPlaneError,
  assertWorkerToken,
  workerTokenLifetime,
} from "./worker-client.js";

function jwt(payload) {
  const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.signature`;
}

function stubClient(handler) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ name, args });
      return handler(name, args) ?? { data: null, error: null };
    },
  };
}

test("a token carrying the wrong role is rejected at startup", () => {
  assert.throws(
    () => assertWorkerToken(jwt({ role: "service_role", worker_id: "worker-guild-a" })),
    /must carry role "guildcloud_site_worker"/,
  );
});

test("a token with no worker_id is rejected at startup", () => {
  assert.throws(
    () => assertWorkerToken(jwt({ role: "guildcloud_site_worker" })),
    /must carry a worker_id claim/,
  );
});

test("a token belonging to a different worker is rejected", () => {
  assert.throws(
    () =>
      assertWorkerToken(jwt({ role: "guildcloud_site_worker", worker_id: "worker-guild-b" }), {
        expectedWorkerId: "worker-guild-a",
      }),
    /does not match configured WORKER_ID/,
  );
});

test("an expired token is rejected rather than failing on the first RPC", () => {
  const expired = jwt({
    role: "guildcloud_site_worker",
    worker_id: "worker-guild-a",
    exp: Math.floor(Date.now() / 1000) - 60,
  });
  assert.throws(() => assertWorkerToken(expired), /has expired/);
});

test("a valid worker token is accepted and its identity returned", () => {
  const payload = assertWorkerToken(
    jwt({ role: "guildcloud_site_worker", worker_id: "worker-guild-a" }),
    { expectedWorkerId: "worker-guild-a" },
  );
  assert.equal(payload.worker_id, "worker-guild-a");
});

test("token lifetime is reported so expiry is visible before it takes a cluster down", () => {
  const now = 1_800_000_000_000;
  const token = jwt({
    role: "guildcloud_site_worker",
    worker_id: "worker-guild-a",
    exp: Math.floor(now / 1000) + 3600,
  });
  assert.equal(workerTokenLifetime(token, now), 3600);
  assert.equal(
    workerTokenLifetime(jwt({ role: "guildcloud_site_worker", worker_id: "w" }), now),
    null,
    "a non-expiring token reports null rather than a bogus number",
  );
});

test("no client method lets the caller name a cluster", async () => {
  const client = stubClient(() => ({ data: null, error: null }));
  const plane = new WorkerControlPlane(client);

  await plane.heartbeat();
  await plane.publishSnapshot({ nodes: [] });
  await plane.claimNextOperation();
  await plane.getOperation("11111111-1111-4111-8111-111111111111");
  await plane.startStage("11111111-1111-4111-8111-111111111111", "proxmox_api_call");
  await plane.finishOperation("11111111-1111-4111-8111-111111111111", "succeeded");

  const serialized = JSON.stringify(client.calls);
  assert.doesNotMatch(serialized, /cluster/i, "no RPC argument may carry a cluster id");
  assert.doesNotMatch(serialized, /guild-a|guild-b/);
});

test("the claim path calls the boundary RPC, never the raw primitive", async () => {
  const client = stubClient(() => ({ data: "op-1", error: null }));
  const plane = new WorkerControlPlane(client);

  assert.equal(await plane.claimNextOperation(), "op-1");
  assert.deepEqual(client.calls, [{ name: "worker_claim_next_operation", args: undefined }]);
});

test("a cross-cluster rejection is reported as not-ours, not as a transient fault", async () => {
  const client = stubClient(() => ({
    data: null,
    error: { code: "P0002", message: "operation not found for this cluster" },
  }));
  const plane = new WorkerControlPlane(client);

  const error = await plane
    .getOperation("11111111-1111-4111-8111-111111111111")
    .then(() => null, (e) => e);

  assert.ok(error instanceof WorkerControlPlaneError);
  assert.equal(error.isNotOurs, true);
  assert.equal(error.isIdentityRejected, false);
});

test("an unrecognized worker identity is distinguishable from a missing row", async () => {
  const client = stubClient(() => ({
    data: null,
    error: { code: "28000", message: "worker identity is not recognized" },
  }));
  const plane = new WorkerControlPlane(client);

  const error = await plane.heartbeat().then(() => null, (e) => e);

  assert.equal(error.isIdentityRejected, true);
  assert.equal(error.isNotOurs, false);
});

test("stage completion forwards status and detail without inventing a cluster", async () => {
  const client = stubClient(() => ({ data: null, error: null }));
  const plane = new WorkerControlPlane(client);

  await plane.completeStage("op-1", "proxmox_api_call", "succeeded", { upid: "UPID:x" });

  assert.deepEqual(client.calls[0].args, {
    p_operation_id: "op-1",
    p_stage: "proxmox_api_call",
    p_status: "succeeded",
    p_detail: { upid: "UPID:x" },
    p_error: null,
  });
});

test("no slice B method lets the caller name a cluster either", async () => {
  const client = stubClient(() => ({ data: null, error: null }));
  const plane = new WorkerControlPlane(client);

  await plane.updateInstanceRuntime("i-1", { proxmox_vmid: 101 });
  await plane.listPendingDeletions();
  await plane.listPendingSshKeySyncs();
  await plane.holdCapacity({
    operationId: "op-1", node: "nodeA", vcpu: 2, memoryGb: 4, diskGb: 40,
    storageId: "ceph-vm", expiresAt: "2026-08-29T00:00:00.000Z",
  });
  await plane.releaseCapacity("op-1");
  await plane.listHeldCapacity("nodeA");
  await plane.listWarmPoolVms(["warm"]);
  await plane.claimWarmPoolVm("i-1", "ubuntu-2404", "std-1");
  await plane.recordWarmPoolVm({
    catalogImageId: "ubuntu-2404", catalogPlanId: "std-1",
    proxmoxVmid: 900, proxmoxNode: "nodeA", tailscaleHostname: "pool-900",
  });
  await plane.updateWarmPoolVm("w-1", "warm", { tailscaleDeviceId: "d-1" });
  await plane.getPlan("std-1");
  await plane.listNodeTemplates("ubuntu-2404", "nodeA");
  await plane.getTailnetDesiredState();
  await plane.markProjectAclApplied("p-1");
  await plane.markMemberEnrolled("m-1", "d-1");

  const serialized = JSON.stringify(client.calls);
  assert.doesNotMatch(serialized, /cluster/i, "no RPC argument may carry a cluster id");
  assert.doesNotMatch(serialized, /guild-a|guild-b/);
});

test("every client call targets a worker_ RPC, never a table or raw primitive", async () => {
  const client = stubClient(() => ({ data: null, error: null }));
  const plane = new WorkerControlPlane(client);

  await plane.heartbeat();
  await plane.listPendingDeletions();
  await plane.updateInstanceRuntime("i-1", {});
  await plane.getTailnetDesiredState();

  for (const call of client.calls) {
    assert.match(call.name, /^worker_/, `${call.name} is not a worker boundary RPC`);
  }
});

test("a warm pool claim that finds nothing returns null rather than throwing", async () => {
  const client = stubClient(() => ({ data: null, error: null }));
  const plane = new WorkerControlPlane(client);
  assert.equal(await plane.claimWarmPoolVm("i-1", "ubuntu-2404", "std-1"), null);
});

test("housekeeping refusal surfaces as not-ours rather than an identity failure", async () => {
  // A worker that simply does not hold the role must not look like a worker
  // whose token was rejected: one is normal, the other is a deploy problem.
  const client = stubClient(() => ({
    data: null,
    error: { code: "42501", message: "worker does not hold the tailnet housekeeping role" },
  }));
  const plane = new WorkerControlPlane(client);

  const error = await plane.getTailnetDesiredState().then(() => null, (e) => e);
  assert.equal(error.isNotOurs, true);
  assert.equal(error.isIdentityRejected, false);
});

test("holdsTailnetHousekeeping asks the control plane and carries no cluster", async () => {
  // The point of the RPC: a worker can find out it is not the housekeeper
  // without calling a privileged RPC and being refused. Like every other call on
  // this client it names no cluster -- the database resolves that from the token.
  const client = stubClient((name) =>
    name === "worker_holds_tailnet_housekeeping" ? { data: false, error: null } : { data: null, error: null },
  );
  const plane = new WorkerControlPlane(client);

  assert.equal(await plane.holdsTailnetHousekeeping(), false);
  assert.deepEqual(client.calls, [{ name: "worker_holds_tailnet_housekeeping", args: undefined }]);
  assert.doesNotMatch(JSON.stringify(client.calls), /guild-a|guild-b|cluster/i);
});

test("holdsTailnetHousekeeping returns true for the holder", async () => {
  const client = stubClient(() => ({ data: true, error: null }));
  const plane = new WorkerControlPlane(client);
  assert.equal(await plane.holdsTailnetHousekeeping(), true);
});

test("holdsTailnetHousekeeping surfaces a revoked worker instead of answering false", async () => {
  // A revoked worker must not be able to hide behind a plain `false`: the RPC
  // resolves the cluster first, so revocation raises here exactly as it does on
  // every other worker_* call.
  const client = stubClient(() => ({
    data: null,
    error: { code: "28000", message: "worker identity is unknown or revoked" },
  }));
  const plane = new WorkerControlPlane(client);

  const error = await plane.holdsTailnetHousekeeping().then(() => null, (e) => e);
  assert.ok(error, "a revoked worker must raise, not resolve to false");
  assert.match(String(error.message), /unknown or revoked/);
});
