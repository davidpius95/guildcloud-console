import assert from "node:assert/strict";
import test from "node:test";

import { healthFailures } from "./health-failures.js";

test("a fully healthy report has no failures", () => {
  assert.deepEqual(
    healthFailures({
      controlPlaneReachable: true,
      proxmoxCredentialReadable: true,
      proxmoxApiReachable: true,
    }),
    [],
  );
});

test("the 2026-08-29 outage is now caught", () => {
  // Exactly what both clusters reported: the control plane was reachable, because
  // worker_heartbeat needs no Vault, while the Proxmox credential could not be
  // read at all. The old check looked only at controlPlaneReachable and so
  // reported healthy -- which is what let the cutover remove the service-role key
  // and disabled the automatic rollback on both clusters.
  const report = {
    controlPlaneReachable: true,
    proxmoxCredentialReadable: false,
    proxmoxCredentialError:
      "could not read vault secret proxmox_guild_b_site_worker_token: " +
      "permission denied for function get_vault_secret",
  };
  assert.deepEqual(healthFailures(report), ["Proxmox credential"]);
});

test("a readable token that Proxmox refuses is still a failure", () => {
  // Reading the credential is not the same as it working. An expired or revoked
  // API token reads out of the vault perfectly.
  assert.deepEqual(
    healthFailures({
      controlPlaneReachable: true,
      proxmoxCredentialReadable: true,
      proxmoxApiReachable: false,
      proxmoxApiError: "Proxmox GET version -> 401",
    }),
    ["Proxmox API"],
  );
});

test("every broken credential is named, not just the first", () => {
  assert.deepEqual(
    healthFailures({
      controlPlaneReachable: false,
      proxmoxCredentialReadable: false,
      proxmoxApiReachable: false,
    }),
    ["control plane", "Proxmox credential", "Proxmox API"],
  );
});

test("checks that did not run are not treated as failures", () => {
  // The legacy path has no control plane, and the Proxmox checks are skipped
  // when no client could be built. Absent must not read as failed, or --health
  // fails closed on workers that are fine.
  assert.deepEqual(healthFailures({}), []);
  assert.deepEqual(healthFailures({ controlPlaneReachable: true }), []);
  // Undefined specifically, rather than any falsy value.
  assert.deepEqual(healthFailures({ proxmoxApiReachable: undefined }), []);
});

test("a worker that verifies no certificates is not healthy", () => {
  // Reaching everything while checking nothing is not health, it is quietly
  // insecure -- and it is exactly what the worker did before 2026-08-29, when
  // NODE_TLS_REJECT_UNAUTHORIZED=0 was set process-wide and the worker token
  // travelled to Supabase over connections nobody verified.
  assert.deepEqual(
    healthFailures({
      controlPlaneReachable: true,
      proxmoxCredentialReadable: true,
      proxmoxApiReachable: true,
      tlsVerificationEnabled: false,
    }),
    ["TLS verification disabled"],
  );
});

test("TLS verification being enabled, or unreported, is not a failure", () => {
  assert.deepEqual(healthFailures({ tlsVerificationEnabled: true }), []);
  assert.deepEqual(healthFailures({}), []);
});
