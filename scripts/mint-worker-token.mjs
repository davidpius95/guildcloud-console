#!/usr/bin/env node
// Mints a cluster-scoped site-worker JWT (plan Task 7 slice C).
//
// Deliberately a one-shot operator script rather than infrastructure-as-code.
// The output IS a long-lived credential: putting it in Terraform state, a CI
// variable, or a committed file turns each of those into a secret store. It
// should travel from this script straight into one worker's
// /etc/guildcloud/worker.env and exist nowhere else.
//
// Usage:
//   Preferred (ES256, key you control -- survives legacy-secret revocation):
//     node scripts/mint-worker-token.mjs --worker-id guild-b-lxc-500 \
//       --signing-key-file ./signing-key.json [--expires-in 365d] [--print]
//
//   Legacy (HS256, dies when the legacy JWT secret is revoked):
//     SUPABASE_JWT_SECRET=... node scripts/mint-worker-token.mjs \
//       --worker-id guild-a-lxc-500 [--expires-in 365d] [--print]
//
//   Generate an ES256 key with `supabase gen signing-key --algorithm ES256`,
//   import it as a standby key in the dashboard, rotate to it, then mint here.
//
// Without --print the token is written to a 0600 file rather than to stdout, so
// it does not land in shell history, terminal scrollback, or a CI log.
//
// It is written OUTSIDE any git working tree. Writing it to the current
// directory was the original behaviour and it went wrong immediately: a minted
// token was swept into a commit by a `git add -A` and pushed to this public
// repository on 2026-08-29. The identity had to be revoked and re-minted. A
// tool that emits a credential should not drop it somewhere a routine `git add`
// will pick up.
//
// The signed token carries no cluster. The cluster is resolved by the database
// from public.worker_identities, so minting a token does not grant access on
// its own -- an identity row must exist and not be revoked.

import { createHmac, createPrivateKey, randomUUID, sign as cryptoSign } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { argv, env, exit } from "node:process";

const WORKER_ROLE = "guildcloud_site_worker";

function parseArgs(args) {
  const parsed = { expiresIn: "365d", print: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--worker-id") parsed.workerId = args[++i];
    else if (arg === "--expires-in") parsed.expiresIn = args[++i];
    else if (arg === "--signing-key-file") parsed.signingKeyFile = args[++i];
    else if (arg === "--print") parsed.print = true;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else {
      console.error(`Unknown argument: ${arg}`);
      exit(2);
    }
  }
  return parsed;
}

// Accepts 30d / 12h / 3600s / a bare number of seconds. Rejects anything else
// rather than guessing: a misparsed duration is either an instantly-dead worker
// or a credential that outlives the project.
export function parseDuration(value) {
  const match = /^(\d+)([smhd])?$/.exec(String(value ?? "").trim());
  if (!match) throw new Error(`Could not parse duration ${JSON.stringify(value)}`);
  const amount = Number(match[1]);
  const unit = match[2] ?? "s";
  const seconds = { s: 1, m: 60, h: 3600, d: 86400 }[unit];
  if (amount <= 0) throw new Error("Duration must be positive");
  return amount * seconds;
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

// Parses the JWK that `supabase gen signing-key --algorithm ES256` emits, and
// returns a private key plus the kid the JWT header must carry so Supabase can
// pick the right key to verify with.
export function loadSigningKey(jwkText) {
  let jwk;
  try {
    jwk = typeof jwkText === "string" ? JSON.parse(jwkText) : jwkText;
  } catch {
    throw new Error("signing key must be JSON (the JWK from `supabase gen signing-key`)");
  }
  if (jwk.kty !== "EC" || jwk.crv !== "P-256") {
    throw new Error(`signing key must be an EC P-256 JWK, got kty=${jwk.kty} crv=${jwk.crv}`);
  }
  if (!jwk.d) throw new Error("signing key is missing its private component (d)");
  if (!jwk.kid) throw new Error("signing key is missing kid; Supabase needs it to select the key");
  return { key: createPrivateKey({ key: jwk, format: "jwk" }), kid: jwk.kid };
}

export function mintWorkerToken({ secret, signingKey, workerId, expiresInSeconds, now = Date.now() }) {
  if (!secret && !signingKey) {
    throw new Error("SUPABASE_JWT_SECRET is required");
  }
  if (!workerId || !/^[a-z0-9][a-z0-9-]{2,62}$/.test(workerId)) {
    throw new Error(
      "--worker-id must be a lowercase slug (letters, digits, hyphens), 3-63 chars",
    );
  }

  const issuedAt = Math.floor(now / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    // PostgREST reads `role` and switches into that Postgres role. This is the
    // whole authorization story: guildcloud_site_worker holds EXECUTE on the
    // worker_* RPCs and nothing else.
    role: WORKER_ROLE,
    worker_id: workerId,
    iss: "guildcloud-worker-mint",
    iat: issuedAt,
    exp: issuedAt + expiresInSeconds,
    // Lets one specific token be identified in logs, and distinguishes two
    // tokens minted for the same worker during a rotation.
    jti: randomUUID(),
  };

  if (signingKey) {
    // ES256 uses the raw r||s form (IEEE P1363), not the DER encoding Node
    // produces by default. Getting this wrong yields a token that looks fine and
    // fails every verification.
    header.alg = "ES256";
    header.kid = signingKey.kid;
  }

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = signingKey
    ? cryptoSign("sha256", Buffer.from(signingInput), {
        key: signingKey.key,
        dsaEncoding: "ieee-p1363",
      }).toString("base64url")
    : createHmac("sha256", secret).update(signingInput).digest("base64url");
  return { token: `${signingInput}.${signature}`, payload };
}

// True when `dir` (or an ancestor) contains a .git entry -- i.e. writing there
// risks the file being committed.
export function isInsideGitWorkTree(dir) {
  let current = resolve(dir);
  for (;;) {
    if (existsSync(join(current, ".git"))) return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

// Never the current directory when that sits in a repository.
function resolveOutfile(name) {
  const cwd = process.cwd();
  return isInsideGitWorkTree(cwd) ? join(tmpdir(), name) : join(cwd, name);
}

function main() {
  const args = parseArgs(argv.slice(2));

  if (args.help || !args.workerId) {
    console.error(
      [
        "Mint a cluster-scoped site-worker JWT.",
        "",
        "  SUPABASE_JWT_SECRET=... node scripts/mint-worker-token.mjs \\",
        "    --worker-id <worker-id> [--expires-in 365d] [--print]",
        "",
        "The worker id must already exist in public.worker_identities, or the",
        "token authenticates as a worker the database does not recognise and",
        "every RPC fails closed with 28000.",
      ].join("\n"),
    );
    exit(args.help ? 0 : 2);
  }

  const expiresInSeconds = parseDuration(args.expiresIn);

  // ES256 with a key you control is the preferred path: those tokens survive
  // revocation of the legacy JWT secret, which HS256 tokens do not -- they are
  // signed with the very secret that has to be retired.
  const jwkText = args.signingKeyFile
    ? readFileSync(args.signingKeyFile, "utf8")
    : env.SUPABASE_SIGNING_KEY;
  const signingKey = jwkText ? loadSigningKey(jwkText) : null;

  if (!signingKey) {
    console.error(
      "WARNING: signing HS256 with the legacy JWT secret. Those tokens die when that\n" +
        "secret is revoked. Prefer --signing-key-file with a key from\n" +
        "`supabase gen signing-key --algorithm ES256`.",
    );
  }

  const { token, payload } = mintWorkerToken({
    secret: env.SUPABASE_JWT_SECRET,
    signingKey,
    workerId: args.workerId,
    expiresInSeconds,
  });

  // Never the token itself: this is the part that is safe to paste into a
  // change record.
  const summary = {
    worker_id: payload.worker_id,
    role: payload.role,
    algorithm: signingKey ? "ES256" : "HS256",
    kid: signingKey ? signingKey.kid : null,
    jti: payload.jti,
    issued_at: new Date(payload.iat * 1000).toISOString(),
    expires_at: new Date(payload.exp * 1000).toISOString(),
  };

  if (args.print) {
    console.error(JSON.stringify(summary, null, 2));
    console.log(token);
    return;
  }

  const outfile = resolveOutfile(`worker-token-${payload.worker_id}.jwt`);
  writeFileSync(outfile, `${token}\n`, { mode: 0o600 });
  console.error(JSON.stringify({ ...summary, written_to: outfile }, null, 2));
  console.error(
    `\nWrote ${outfile} (0600), outside any git working tree.\n` +
      `Move it into the worker's /etc/guildcloud/worker.env as SUPABASE_WORKER_TOKEN,\n` +
      `then delete it.`,
  );
}

// Importable for tests without minting on import.
if (import.meta.url === `file://${argv[1]}`) main();
