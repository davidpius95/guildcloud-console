// Which credentials in a --health report are broken.
//
// Its own module because index.js calls run() at import time, so nothing can
// import it from a test. That is why the health logic had no test when it
// silently passed through the 2026-08-29 outage on both clusters.

// A worker is healthy only if every credential it depends on works. Returns the
// list rather than a boolean so the deploy log names the one that broke.
//
// Deliberately checks `=== false`, not falsiness. A check that did not run is
// absent from the report, and absent must not read as failed: the legacy path
// has no control plane, and the Proxmox checks are skipped when no client could
// be built. Treating undefined as failure would make --health fail closed on
// workers that are fine.
export function healthFailures(report) {
  const failures = [];
  if (report.controlPlaneReachable === false) failures.push("control plane");
  if (report.proxmoxCredentialReadable === false) failures.push("Proxmox credential");
  if (report.proxmoxApiReachable === false) failures.push("Proxmox API");
  // A worker that reaches everything while verifying no certificates is not
  // healthy, it is quietly insecure. index.js refuses to start in that state, so
  // this is a second line rather than the only one.
  if (report.tlsVerificationEnabled === false) failures.push("TLS verification disabled");
  return failures;
}
