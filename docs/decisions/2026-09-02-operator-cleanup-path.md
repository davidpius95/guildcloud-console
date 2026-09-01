# Operator cleanup: grant the ability to ask, not the ability to destroy

**Date:** 2026-09-02
**Status:** implemented (`20260902100000`, `scripts/operator-cleanup.mjs`)

## The problem

Platform staff had no supported way to clean up a tenant's abandoned
infrastructure. On 2026-09-02 two abandoned clones belonging to another tenant
had to be removed by destroying the guests through the Proxmox API and deleting
the control-plane rows by hand with service-role access.

That worked, and it is a bad habit to acquire. Destroying a guest without also
removing its row leaves a `failed` instance naming a vmid Proxmox will reissue,
so a later delete resolves `node + vmid` onto an unrelated customer's server.
The safe sequence existed only in an operator's head, and the tool that made it
possible -- the service-role key -- bypasses RLS entirely, putting every table
one typo away.

## The decision

**An operator gets the ability to request a delete, not the ability to perform
one.**

Only the site worker can reach Proxmox; the console and this script have no
Proxmox credentials and are not given any. An operator who can request a delete
therefore inherits the entire hardened teardown for free -- guest destroyed,
tailnet device released, rows removed, capacity released -- through exactly the
code path a customer's own delete uses.

That is the property worth having: **there is no second teardown implementation
to keep in step with the first.** Every fix made to the delete path on
2026-09-01 and 2026-09-02 (idempotent tailnet delete, guest-presence check
instead of inferring from a 403) applies to operator cleanup automatically,
because it *is* the same path.

## What was built

- `platform_operators`, a table with RLS enabled and **no policy at all**. Rows
  are added out of band, never through the app, so the app can never widen its
  own authority. Membership is read only through `is_platform_operator()`.
- `request_instance_delete` accepts an operator alongside the org's own
  Owner/Admin. Nothing else about it changed: same queue, same stages, same
  worker, same state guards.
- Operator-initiated deletes are written to the **tenant's own** `audit_log`, so
  the customer can see that platform staff acted on their resource. This
  required widening `log_audit_event`'s membership check rather than inserting
  directly, so that function remains the single insert path into `audit_log` --
  the property that table's comment depends on.
- `operator_list_abandoned_instances()`, deliberately narrow: only instances in
  `failed`, `degraded` or `delete_failed`. An operator has no business listing
  every tenant's running servers, and this is the listing that answers "what has
  been abandoned".
- `scripts/operator-cleanup.mjs`, which signs in as the operator themselves. No
  service-role key appears anywhere in it.

## What was rejected

**A console admin page.** It would be better ergonomics, but it introduces a
cross-tenant admin UI -- a permanently exposed surface that must be got right
forever -- to solve a problem staff hit rarely. A script keeps the capability
out of the authenticated web surface entirely. The RPCs are the real interface;
a page can be built on them later if the need is proven.

**Detecting true orphans** (guests present on a node with no instance row, such
as `iiiuuu` 119 and `coolify` 121 before they were removed). The control plane
has no handle on those at all, so it needs a worker-side reconciliation sweep
over each cluster's pool -- and one that will not reap templates, the worker's
own LXC, or warm-pool VMs. Real work, deliberately not bundled in here.

**Deleting rows directly, faster.** Rejected precisely because it is what the
manual cleanup did. It is the version that can destroy the wrong server.

## Scope limit worth stating

This covers instances the control plane knows about. It does not detect
infrastructure the control plane has never heard of, and it does not let an
operator delete a *healthy* instance -- the listing only surfaces abandoned
states, and the delete is driven from that listing.
