import assert from "node:assert/strict";
import test from "node:test";

import { mintWorkerToken, parseDuration } from "./mint-worker-token.mjs";

const SECRET = "test-secret-not-a-real-jwt-secret";

function decode(token) {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}

test("durations parse in the units an operator would actually type", () => {
  assert.equal(parseDuration("3600"), 3600);
  assert.equal(parseDuration("90s"), 90);
  assert.equal(parseDuration("15m"), 900);
  assert.equal(parseDuration("12h"), 43200);
  assert.equal(parseDuration("365d"), 31536000);
});

test("an unparseable or zero duration is rejected rather than guessed", () => {
  // Guessing here is either an instantly-dead worker or a credential that
  // outlives the project.
  for (const bad of ["", "abc", "1w", "-5d", "0d", "5 days", null]) {
    assert.throws(() => parseDuration(bad), `expected ${JSON.stringify(bad)} to throw`);
  }
});

test("the minted token carries the worker role PostgREST switches on", () => {
  const { token } = mintWorkerToken({
    secret: SECRET,
    workerId: "guild-a-lxc-500",
    expiresInSeconds: 3600,
  });
  const payload = decode(token);
  assert.equal(payload.role, "guildcloud_site_worker");
  assert.equal(payload.worker_id, "guild-a-lxc-500");
});

test("the token never carries a cluster claim", () => {
  // The database resolves the cluster from worker_identities. A cluster claim
  // here would be a second, forgeable source of truth. Note the worker id may
  // legitimately contain the cluster name -- it is a human-readable identifier,
  // not an authorization input -- so this asserts on claim keys, not on values.
  const { token } = mintWorkerToken({
    secret: SECRET,
    workerId: "guild-a-lxc-500",
    expiresInSeconds: 3600,
  });
  const payload = decode(token);
  assert.deepEqual(
    Object.keys(payload).filter((key) => /cluster/i.test(key)),
    [],
    "no claim key may name a cluster",
  );
  assert.equal(payload.cluster_id, undefined);
});

test("expiry is set from the requested duration", () => {
  const now = 1_800_000_000_000;
  const { payload } = mintWorkerToken({
    secret: SECRET,
    workerId: "guild-a-lxc-500",
    expiresInSeconds: 86400,
    now,
  });
  assert.equal(payload.exp - payload.iat, 86400);
  assert.equal(payload.iat, Math.floor(now / 1000));
});

test("two tokens for the same worker are distinguishable during a rotation", () => {
  const first = mintWorkerToken({ secret: SECRET, workerId: "w-1", expiresInSeconds: 60 });
  const second = mintWorkerToken({ secret: SECRET, workerId: "w-1", expiresInSeconds: 60 });
  assert.notEqual(first.payload.jti, second.payload.jti);
});

test("a missing secret fails loudly instead of signing with undefined", () => {
  assert.throws(
    () => mintWorkerToken({ secret: "", workerId: "w-1", expiresInSeconds: 60 }),
    /SUPABASE_JWT_SECRET is required/,
  );
});

test("a malformed worker id is rejected before signing", () => {
  // A typo here mints a credential the database will never recognise, which
  // surfaces as an idle cluster rather than an obvious failure.
  for (const bad of ["", "ab", "Guild-A", "guild a", "-leading", "x".repeat(64)]) {
    assert.throws(
      () => mintWorkerToken({ secret: SECRET, workerId: bad, expiresInSeconds: 60 }),
      /--worker-id must be a lowercase slug/,
      `expected ${JSON.stringify(bad)} to be rejected`,
    );
  }
});

test("the signature changes with the secret, so a wrong secret cannot pass", () => {
  const a = mintWorkerToken({ secret: SECRET, workerId: "w-1", expiresInSeconds: 60, now: 1 });
  const b = mintWorkerToken({ secret: "other", workerId: "w-1", expiresInSeconds: 60, now: 1 });
  assert.notEqual(a.token.split(".")[2], b.token.split(".")[2]);
});
