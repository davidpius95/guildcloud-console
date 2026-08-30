import assert from "node:assert/strict";
import test from "node:test";

import { sealTableAccess } from "./seal-table-access.js";

function fakeClient() {
  return {
    from(table) {
      return { table, select: () => ({ data: [], error: null }) };
    },
    rpc(name, args) {
      return { name, args, data: "rpc-result", error: null };
    },
    plainValue: 42,
  };
}

test("a table access on the sealed client throws instead of returning nothing", () => {
  const sealed = sealTableAccess(fakeClient());
  assert.throws(
    () => sealed.from("operations"),
    /Table access "operations" on the worker_token path/,
  );
});

test("the error names the table, so the offending call site is obvious", () => {
  const sealed = sealTableAccess(fakeClient());
  assert.throws(() => sealed.from("capacity_reservations"), /"capacity_reservations"/);
  assert.throws(() => sealed.from("warm_pool_vms"), /"warm_pool_vms"/);
});

test("it points at the fix rather than only reporting the failure", () => {
  const sealed = sealTableAccess(fakeClient());
  assert.throws(() => sealed.from("instances"), /use a worker_\* RPC via controlPlane instead/);
});

// The seal must not break the path the worker actually uses. Every boundary
// call goes through .rpc(), so sealing .from() has to leave that untouched.
test("rpc still works on the sealed client", () => {
  const sealed = sealTableAccess(fakeClient());
  const result = sealed.rpc("worker_list_cluster_operations", { p_limit: 10 });
  assert.equal(result.data, "rpc-result");
  assert.equal(result.name, "worker_list_cluster_operations");
});

test("non-function properties still read through", () => {
  const sealed = sealTableAccess(fakeClient());
  assert.equal(sealed.plainValue, 42);
});

// The failure this whole module exists to prevent: a denied read that looks
// like "no work to do". Asserted as a behavioural difference, not a comment.
test("the silent-empty-list failure mode is no longer reachable", () => {
  const denied = {
    from() {
      // What PostgREST actually did: an error in the payload, no throw.
      return {
        select: () => ({
          eq: () => ({ in: () => ({ order: () => ({ limit: () => ({ data: null, error: { message: "permission denied for table operations" } }) }) }) }),
        }),
      };
    },
  };

  // Before: `const { data } = ...` then `data ?? []` yields an empty list, and
  // the worker decides there is nothing to do.
  const { data } = denied.from("operations").select().eq().in().order().limit();
  assert.deepEqual(data ?? [], [], "the old shape really did produce an empty list");

  // After: the call cannot even be made.
  assert.throws(() => sealTableAccess(denied).from("operations"));
});
