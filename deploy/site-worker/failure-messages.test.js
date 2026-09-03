import assert from "node:assert/strict";
import test from "node:test";

import { describeFailure } from "./failure-messages.js";

test("the 2026-09-03 ENOSPC creates are now explained", () => {
  // The exact failure_reason recorded on both failed guild-b creates.
  const message = describeFailure(new Error("ENOSPC: no space left on device, close"));
  assert.match(message, /ran out of shared storage/);
  assert.match(message, /ours to fix/);
  // The customer must not be told to change the plan or image: neither would
  // have helped, and that was the misleading part of the raw errno.
  assert.match(message, /nothing you change about the plan or image will help/i);
  assert.doesNotMatch(message, /ENOSPC/);
});

test("a stale mount is not reported as a full disk", () => {
  // Both are storage faults but the operator action differs: remount vs free
  // space. Collapsing them into one message is what makes an alert useless.
  const stale = describeFailure(new Error("EIO: stale file handle, open '/mnt/guild-snippets/x.yaml'"));
  assert.match(stale, /lost access to its shared storage/);
  assert.doesNotMatch(stale, /ran out of/);
});

test("a Proxmox permission failure reads as permission, not as a generic 4xx", () => {
  // Ordering regression guard: this string contains both "403" and
  // "Permission check failed", and must match the permission rule.
  const message = describeFailure(
    new Error('Proxmox DELETE nodes/nodeA/qemu/102 -> 403: {"message":"Permission check failed (/vms/102, VM.Allocate)"}'),
  );
  assert.match(message, /missing a permission/);
});

test("an unrecognized error is passed through verbatim", () => {
  // Never replace a lead an operator could use with a vague apology.
  const raw = "some entirely new failure nobody has seen yet";
  assert.equal(describeFailure(new Error(raw)), raw);
});

test("an empty or missing error still produces a sentence", () => {
  assert.match(describeFailure(new Error("")), /could not be created/);
  assert.match(describeFailure(null), /could not be created/);
});

test("network faults are reported as retryable", () => {
  assert.match(describeFailure(new Error("connect ETIMEDOUT 192.168.8.126:8006")), /try again shortly/);
});
