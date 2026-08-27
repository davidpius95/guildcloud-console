import assert from "node:assert/strict";
import test from "node:test";

import { GUEST_SSH_VERIFICATION_SCRIPT, parseGuestSshVerification } from "./automated-verification.js";

test("guest SSH verification script checks both service state and port 22", () => {
  assert.match(GUEST_SSH_VERIFICATION_SCRIPT, /systemctl is-active ssh/);
  assert.match(GUEST_SSH_VERIFICATION_SCRIPT, /ssh_port=listening/);
  assert.match(GUEST_SSH_VERIFICATION_SCRIPT, /exit 12/);
});

test("parseGuestSshVerification accepts an active service on port 22", () => {
  const parsed = parseGuestSshVerification({
    "out-data": "ssh_service=active\nssh_port=listening\n",
    "err-data": "",
  });

  assert.equal(parsed.serviceActive, true);
  assert.equal(parsed.portListening, true);
});

test("parseGuestSshVerification rejects a non-listening ssh port", () => {
  const parsed = parseGuestSshVerification({
    "out-data": "ssh_service=active\nssh_port=not_listening\n",
    "err-data": "",
  });

  assert.equal(parsed.serviceActive, true);
  assert.equal(parsed.portListening, false);
});
