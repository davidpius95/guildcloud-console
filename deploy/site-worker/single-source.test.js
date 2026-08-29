import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the Guild-A launcher contains no second worker implementation", async () => {
  const launcher = await readFile(new URL("../site-worker-guild-a/index.js", import.meta.url), "utf8");
  const executableLines = launcher.split("\n").filter((line) => line.trim() && !line.trim().startsWith("//"));

  assert.match(launcher, /import\s+["']\.\.\/site-worker\/index\.js["']/);
  assert.ok(executableLines.length <= 2, `launcher has ${executableLines.length} executable lines`);
  assert.doesNotMatch(launcher, /createClient|SUPABASE_SERVICE_ROLE_KEY|function processOneStage/);
});
