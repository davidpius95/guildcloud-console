import assert from "node:assert/strict";
import test from "node:test";

import { generateKeyPairSync, verify } from "node:crypto";
import { tmpdir } from "node:os";

import {
  isInsideGitWorkTree,
  loadSigningKey,
  mintWorkerToken,
  parseDuration,
} from "./mint-worker-token.mjs";

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

test("a git working tree is detected, so tokens are never written into a repo", () => {
  // The original script wrote to the current directory. A minted token was
  // swept into a commit by `git add -A` and pushed to a public repository on
  // 2026-08-29; the identity had to be revoked and re-minted.
  assert.equal(isInsideGitWorkTree(process.cwd()), true, "the repo itself must be detected");
  assert.equal(isInsideGitWorkTree(tmpdir()), false, "the temp dir must not be");
});

test("an ES256 token verifies against the public half of its signing key", () => {
  // The real point of ES256 here: these tokens survive revocation of the legacy
  // JWT secret, which HS256 tokens cannot.
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = { ...privateKey.export({ format: "jwk" }), kid: "test-kid-1" };

  const signingKey = loadSigningKey(JSON.stringify(jwk));
  const { token } = mintWorkerToken({
    signingKey,
    workerId: "guild-b-lxc-500",
    expiresInSeconds: 3600,
  });

  const [h, p, sig] = token.split(".");
  const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
  assert.equal(header.alg, "ES256");
  assert.equal(header.kid, "test-kid-1", "Supabase selects the key by kid");

  // ES256 signatures are raw r||s, not DER. Verifying with the default encoding
  // would fail even on a correct token.
  assert.equal(
    verify("sha256", Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(sig, "base64url")),
    true,
    "signature must verify with the public key",
  );
});

test("a tampered ES256 payload fails verification", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = { ...privateKey.export({ format: "jwk" }), kid: "test-kid-2" };
  const { token } = mintWorkerToken({
    signingKey: loadSigningKey(JSON.stringify(jwk)),
    workerId: "guild-b-lxc-500",
    expiresInSeconds: 3600,
  });
  const [h, , sig] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url");
  assert.equal(
    verify("sha256", Buffer.from(`${h}.${forged}`), { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(sig, "base64url")),
    false,
  );
});

test("a signing key that is not EC P-256, or lacks kid or private part, is rejected", () => {
  assert.throws(() => loadSigningKey('{"kty":"RSA","kid":"x","d":"y"}'), /EC P-256/);
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = privateKey.export({ format: "jwk" });
  assert.throws(() => loadSigningKey(JSON.stringify(jwk)), /missing kid/);
  assert.throws(() => loadSigningKey(JSON.stringify({ ...jwk, kid: "k", d: undefined })), /private component/);
  assert.throws(() => loadSigningKey("not json"), /must be JSON/);
});
