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
