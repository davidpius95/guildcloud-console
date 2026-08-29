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

test("every control-plane table access is guarded by the RPC boundary", async () => {
  // The database role has no table privileges, so an unguarded .from() would
  // fail at runtime in worker_token mode -- on whatever production cluster ran
  // it first. Catch it here instead.
  //
  // Guarded means: reachable only when `controlPlane` is null (legacy
  // service-role path), or gated on data the boundary listing already supplied.
  const source = await readFile(new URL("./index.js", import.meta.url), "utf8");
  const lines = source.split("\n");
  const unguarded = [];

  lines.forEach((line, index) => {
    const match = line.match(/\.from\("([a-z_]+)"\)/);
    if (!match) return;
    const context = lines.slice(Math.max(0, index - 18), index + 1).join("\n");
    const guarded =
      context.includes("controlPlane") ||
      context.includes("inst.operation_id") ||
      context.includes("inst.public_keys");
    if (!guarded) unguarded.push(`${index + 1}: ${match[1]}`);
  });

  assert.deepEqual(
    unguarded,
    [],
    `these table accesses would run against a role with no table privileges:\n${unguarded.join("\n")}`,
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
