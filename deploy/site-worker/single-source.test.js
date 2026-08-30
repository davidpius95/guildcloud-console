import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// This one guards a *repository* invariant, not a runtime one. deploy-pull.sh
// copies only deploy/site-worker/ into a release, so on a deployed worker the
// sibling launcher directory legitimately does not exist -- and a hard failure
// there blocks every future deploy, because deploy-pull.sh runs `npm test`
// before switching the symlink. That is exactly what happened: both production
// workers began rejecting all new releases.
test("the Guild-A launcher contains no second worker implementation", async (t) => {
  let launcher;
  try {
    launcher = await readFile(new URL("../site-worker-guild-a/index.js", import.meta.url), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    t.skip("sibling launcher absent: running from a deployed release, not a repo checkout");
    return;
  }
  const executableLines = launcher.split("\n").filter((line) => line.trim() && !line.trim().startsWith("//"));

  assert.match(launcher, /import\s+["']\.\.\/site-worker\/index\.js["']/);
  assert.ok(executableLines.length <= 2, `launcher has ${executableLines.length} executable lines`);
  assert.doesNotMatch(launcher, /createClient|SUPABASE_SERVICE_ROLE_KEY|function processOneStage/);
});

test("the worker_token client is sealed, so a table access cannot fail silently", async () => {
  // This replaces a text-scan that could not fail.
  //
  // The old version looked 18 lines above each `.from("...")` for the word
  // "controlPlane" and called the call site guarded if it found one. It
  // reported all 42 call sites as guarded -- including claimPendingOperations,
  // which read `operations` unconditionally. When both workers moved to
  // worker_token the read was denied, the code destructured only `data`, and
  // an empty list became "no work to do". Instance creation was dead in
  // production for nine hours and this test stayed green the whole time.
  //
  // A heuristic that passes on every input proves nothing. The invariant is now
  // enforced at runtime by sealTableAccess() (with its own behavioural tests),
  // and what is checked here is that the seal is actually installed on the
  // client the worker_token path returns -- which is the one thing a source
  // scan can establish honestly.
  const source = await readFile(new URL("./index.js", import.meta.url), "utf8");

  assert.match(
    source,
    /import \{ sealTableAccess \} from "\.\/seal-table-access\.js"/,
    "index.js must import the seal",
  );

  const workerTokenBranch = source.slice(
    source.indexOf("controlPlane = new WorkerControlPlane(client)"),
  );
  assert.match(
    workerTokenBranch.slice(0, 200),
    /return sealTableAccess\(client\)/,
    "the worker_token path must return the sealed client, not the raw one",
  );

  // The legacy path must NOT be sealed: it has no boundary RPCs to use and
  // every table access there is legitimate.
  const legacyBranch = source.slice(source.indexOf("SUPABASE_SERVICE_ROLE_KEY in environment"));
  assert.doesNotMatch(
    legacyBranch.slice(0, 300),
    /sealTableAccess/,
    "the service_role path must keep working table access",
  );
});

test("the operation listing goes through the boundary, not a table read", async () => {
  // The specific regression: claimPendingOperations listed operations with
  // `.from("operations")`, which the worker role may not do. It must use the
  // RPC, and it must not swallow the error if that call fails.
  const source = await readFile(new URL("./index.js", import.meta.url), "utf8");
  const start = source.indexOf("async function claimPendingOperations");
  assert.ok(start > 0, "claimPendingOperations must exist");
  const body = source.slice(start, source.indexOf("\nasync function", start + 10));

  assert.match(body, /controlPlane\.listClusterOperations\(/, "must list via the boundary RPC");
  assert.doesNotMatch(
    body,
    /const \{ data: ops \} =/,
    "must not destructure only `data` -- that is what hid the permission denial",
  );
});

test("the worker never calls a cluster-parameterised primitive on the boundary path", async () => {
  const source = await readFile(new URL("./index.js", import.meta.url), "utf8");
  for (const primitive of ["place_next_pending_operation", "publish_cluster_snapshot", "touch_worker_heartbeat"]) {
    const calls = source.split(`rpc("${primitive}"`).length - 1;
    if (calls === 0) continue;
    // Each surviving call must sit in a legacy branch.
    const index = source.indexOf(`rpc("${primitive}"`);
    const preceding = source.slice(Math.max(0, index - 700), index);
    assert.match(
      preceding,
      /controlPlane/,
      `${primitive} is called without a controlPlane guard`,
    );
  }
});

test("the worker never disables TLS verification for the whole process", async () => {
  // Setting NODE_TLS_REJECT_UNAUTHORIZED=0 turns off certificate checking for
  // every connection the process makes, including the worker token sent to
  // Supabase and the OAuth secret sent to Tailscale -- not only the Proxmox call
  // it was added for. The supported fix is trusting the Proxmox CA via
  // NODE_EXTRA_CA_CERTS, which leaves everything else verified.
  //
  // Asserted against the source because it is a single line that reads as a
  // harmless local workaround, and it sat in this file for months.
  const source = await readFile(new URL("./index.js", import.meta.url), "utf8");

  // index.js legitimately mentions the variable three times: a comment, a guard
  // that refuses to start when the environment sets it, and a --health field.
  // Only an assignment through process.env is the bug, so comments are stripped,
  // `==`/`===`/`!==` are excluded, and the process.env prefix is required --
  // without it this matched the guard's own error message, which contains the
  // literal text it warns about.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const assignment =
    /process\.env(?:\.NODE_TLS_REJECT_UNAUTHORIZED|\["NODE_TLS_REJECT_UNAUTHORIZED"\])\s*(?<![=!<>])=(?!=)\s*["'`]?0/;

  assert.doesNotMatch(code, assignment, "index.js must not disable TLS verification");

  // Prove the assertion can fail. A guard that cannot detect the thing it guards
  // against is worse than none, since it reads as protection.
  for (const reintroduced of [
    'process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";',
    "process.env.NODE_TLS_REJECT_UNAUTHORIZED='0'",
    'process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0"',
    "process.env.NODE_TLS_REJECT_UNAUTHORIZED =  0",
  ]) {
    assert.match(reintroduced, assignment, `must catch: ${reintroduced}`);
  }

  // And that it does not flag the legitimate comparisons this file contains.
  for (const legitimate of [
    'if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {',
    'report.tlsVerificationEnabled = process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0";',
  ]) {
    assert.doesNotMatch(legitimate, assignment, `must not flag: ${legitimate}`);
  }
});
