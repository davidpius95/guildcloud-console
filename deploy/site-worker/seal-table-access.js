// Makes a table access on the worker_token path fail loudly and immediately.
//
// WHY THIS EXISTS
//
// The worker role holds no table privileges, so any `.from()` on the boundary
// path was already going to fail. The problem was that it failed QUIETLY.
//
// `claimPendingOperations()` read `operations` directly, destructured only
// `data`, and turned a permission denial into an empty list. The worker
// concluded it had no work and logged nothing. Instance creation was dead in
// production for nine hours on 2026-08-29 while heartbeats, capacity publishing
// and deletions all kept working, so nothing looked wrong from outside. Every
// create attempt in that window placed an operation and then abandoned it,
// stranding the instance permanently -- placement only reconsiders operations
// with `cluster_id is null`.
//
// A static test was supposed to catch exactly this and could not: it scanned
// the 18 lines above each `.from()` for the word "controlPlane" and found it
// every time, so it passed on all 42 call sites including the broken one.
//
// This enforces the same invariant where a regex cannot be fooled. Every
// legitimate `.from()` in the worker sits in an `else` branch that runs only
// when controlPlane is null, so reaching one while the boundary client is
// active is unambiguously a bug. It now raises at the call site, naming the
// table, instead of silently returning nothing.

export function sealTableAccess(client) {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "from") {
        return (table) => {
          throw new Error(
            `Table access "${table}" on the worker_token path. The worker role has no table ` +
              `privileges by design (Task 7 boundary); use a worker_* RPC via controlPlane instead.`,
          );
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
