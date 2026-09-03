import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMISSION_FLOOR_BYTES,
  DEFAULT_WARN_BYTES,
  evaluateSnippetStore,
} from "./provisioning-probe.js";

const GIB = 1073741824;
const healthy = { freeBytes: 3.9 * GIB, totalBytes: 4 * GIB };

test("a healthy snippet store is up", () => {
  const result = evaluateSnippetStore(healthy);
  assert.equal(result.ok, true);
  assert.equal(result.severity, "ok");
});

test("the 2026-09-03 ENOSPC outage would have paged", () => {
  // The store was full and every write failed. This is the case that took
  // provisioning down twice with no alert.
  const result = evaluateSnippetStore({
    writeError: "ENOSPC: no space left on device, close",
    freeBytes: 0,
    totalBytes: 300 * GIB,
  });
  assert.equal(result.ok, false);
  assert.equal(result.severity, "critical");
  assert.match(result.reason, /cannot write/);
});

test("the 2026-09-01 ESTALE outage would have paged too", () => {
  // Distinct from ENOSPC and the reason the probe writes instead of only
  // stat-ing: there was plenty of free space, and every write still failed.
  const result = evaluateSnippetStore({
    writeError: "EIO: stale file handle, open '/mnt/guild-snippets/x.yaml'",
    ...healthy,
  });
  assert.equal(result.ok, false);
  assert.equal(result.severity, "critical");
});

test("below the admission floor is critical and says creates are already refused", () => {
  const result = evaluateSnippetStore({ freeBytes: 0.5 * GIB, totalBytes: 4 * GIB });
  assert.equal(result.severity, "critical");
  assert.match(result.reason, /refused at this site right now/);
});

test("a large store under 5% free is critical even though it clears the 1 GiB floor", () => {
  // 4 GiB free of 300 GiB is well past the absolute floor but still fails the
  // ratio condition, so admission refuses. The probe has to agree with the gate.
  const result = evaluateSnippetStore({ freeBytes: 4 * GIB, totalBytes: 300 * GIB });
  assert.equal(result.severity, "critical");
  assert.ok(4 * GIB > ADMISSION_FLOOR_BYTES);
});

test("warns while creates still work, so the page comes before the outage", () => {
  const result = evaluateSnippetStore({ freeBytes: 1.5 * GIB, totalBytes: 4 * GIB });
  assert.equal(result.ok, false);
  assert.equal(result.severity, "warning");
  assert.match(result.reason, /approaching/);
  // The whole point: this is above the floor, so admission is still saying yes.
  assert.ok(1.5 * GIB > ADMISSION_FLOOR_BYTES);
  assert.ok(1.5 * GIB < DEFAULT_WARN_BYTES);
});

test("a store reporting no capacity is not treated as healthy", () => {
  // Guards the obvious failure mode of a stat that silently returns zeroes:
  // 0/0 must not read as "plenty of room".
  const result = evaluateSnippetStore({ freeBytes: 0, totalBytes: 0 });
  assert.equal(result.ok, false);
  assert.equal(result.severity, "critical");
});

test("defaults are not accidentally healthy", () => {
  // Called with nothing at all, the probe must fail rather than report up.
  assert.equal(evaluateSnippetStore().ok, false);
});
