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
