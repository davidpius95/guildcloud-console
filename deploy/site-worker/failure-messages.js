// Turns the raw error off a failed stage into something a customer can act on.
//
// Its own module for the same reason as health-failures.js: index.js runs at
// import time, so nothing there is testable.
//
// The motivating incident (2026-09-03): every instance.create on guild-b died
// at template_cloud_init with `failure_reason` set to the literal Node.js
// string "ENOSPC: no space left on device, close". That told the customer
// nothing -- not which disk, not whose fault, not whether retrying or picking a
// smaller plan would help. The real cause was that the shared snippets NFS
// export sat on the same filesystem as the PBS backup datastore, which had
// grown to 100%. Nothing the customer could change would have fixed it.
//
// The raw text is never thrown away: the caller still records it on the stage,
// which is what an operator reads. Only the customer-facing failure_reason is
// rewritten.

// Ordered most-specific first: the first pattern that matches wins, so a
// Proxmox 403 is reported as a permission problem rather than being swallowed
// by the generic 4xx rule below it.
const PATTERNS = [
  {
    // errno string, and the same condition surfaced through NFS.
    match: /ENOSPC|no space left on device|disk quota exceeded/i,
    message:
      "This site ran out of shared storage while preparing the server, so it could not be created. " +
      "This is ours to fix, not yours - nothing you change about the plan or image will help. " +
      "Nothing was charged. Please try again later or contact support.",
  },
  {
    // A stale handle means the shared export was remounted under a running
    // worker. Distinct from ENOSPC: there is space, the worker just cannot see
    // it until the mount is refreshed.
    match: /ESTALE|stale file handle/i,
    message:
      "This site briefly lost access to its shared storage while preparing the server. " +
      "This is ours to fix - please try creating it again shortly.",
  },
  {
    match: /EACCES|EPERM|permission denied|Permission check failed/i,
    message:
      "This site is missing a permission it needs to create the server. " +
      "This is ours to fix, not yours - please contact support.",
  },
  {
    // Only after EACCES, so "403 Permission check failed" reads as permission.
    match: /\b(4\d\d)\b.*(Proxmox|nodes\/)/i,
    message:
      "The virtualization platform rejected part of this request. " +
      "This is ours to fix, not yours - please contact support.",
  },
  {
    match: /ETIMEDOUT|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|socket hang up/i,
    message:
      "This site stopped responding while the server was being created. " +
      "This is ours to fix - please try again shortly.",
  },
  {
    match: /did not enrol before timeout|did not enroll before timeout/i,
    message:
      "The server was created but never joined your private network, so it would not have been reachable. " +
      "It has been cleaned up and nothing was charged. Please try again.",
  },
  {
    match: /\b5\d\d\b/,
    message:
      "The virtualization platform returned an error while creating this server. " +
      "This is ours to fix - please try again shortly.",
  },
];

// Returns a customer-facing sentence for `error`, or the original text when
// nothing matches.
//
// Falling back to the raw string is deliberate. An unrecognized failure is
// still better shown verbatim than replaced with a vague "something went
// wrong": the raw text is the only lead an operator has, and hiding it is how
// the ENOSPC cause stayed invisible for two failed creates.
export function describeFailure(error) {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const text = raw.trim();
  if (!text) return "The server could not be created. This is ours to fix - please contact support.";

  for (const { match, message } of PATTERNS) {
    if (match.test(text)) return message;
  }
  return text;
}
