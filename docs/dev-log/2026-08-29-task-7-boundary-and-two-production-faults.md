# 2026-08-29 — Task 7 worker boundary shipped; the e2e that verified it found two production faults

Task 7 of `docs/2026-08-29-guildcloud-platform-hardening-and-launch.md` — the
cluster-scoped worker RPC boundary — landed today, along with the repairs to CI
that had to happen first. The end-to-end lifecycle test run to verify it is the
part worth reading: it found that **instance creation was impossible** and that
**deleting an instance provisioned a new VM instead of deleting it**.

## What shipped

| PR | What |
|---|---|
| #14 | Repaired CI. It had never passed since being introduced. |
| #15 | Task 7 slices A and B: the cluster-scoped worker RPC boundary. |
| #12 | Brought the plan doc and `PROJECT_STATUS.md` in line with reality. |
| #16 | Revoked `anon` EXECUTE on three SECURITY DEFINER functions. |
| #17 | The two production faults below. |

### The boundary itself

The site worker held `SUPABASE_SERVICE_ROLE_KEY` — read/write on every table for
every cluster — and every worker RPC took its cluster as a *parameter*, so the
caller asserted its own identity. The Guild-A worker could pass `guild-b`.

Now there is a `guildcloud_site_worker` role with **no table privileges and no
`bypassrls`**, a `worker_identities` table mapping each worker to exactly one
cluster, and `worker_*` RPCs covering every path the worker previously reached by
writing tables directly. `current_worker_cluster()` resolves the cluster **from
the database** using the token's `worker_id` claim, so the cluster is never read
from the token: a stolen token cannot widen its own scope, and revoking a worker
is one `UPDATE` rather than a JWT-secret rotation.

**The service-role key is still on both production workers.** Removing it is the
operational half — mint tokens, canary one cluster, rotate — written up in
`docs/runbooks/2026-08-29-worker-service-role-cutover.md`.
`CONTROL_PLANE_AUTH_MODE` still defaults to `service_role`, so nothing has
changed for a running worker yet.

## Fault 1: no instance could be created, on any cluster, for any customer

Attempting the lifecycle test surfaced it immediately: `can_provision_instance`
returned "No eligible capacity is available" for every organization, image and
plan — while both clusters were `open`, heartbeats were seconds old, templates
were present on podB–podF, and podC/podD had real headroom (8 vCPU, 6 GB free).

Both admission paths require `monitoring_healthy`:

| Gate | How it requires it |
|---|---|
| `can_provision_instance()` | `and monitoring_healthy` in the eligibility expression |
| `place_next_pending_operation()` | a `'monitoring_unhealthy'` entry in `rejection_reasons`, and eligibility is `cardinality(rejection_reasons) = 0` |

`publish_cluster_snapshot()` sets the column with
`coalesce((p_snapshot ->> 'monitoring_healthy')::boolean, false)` — so it is
false unless the worker explicitly sends true. **The worker sends false
deliberately.** From `deploy/site-worker/index.js`: monitoring_healthy has no
real check wired up, because no monitoring system exists in this codebase to
query, so it reports the absence rather than a value nobody verified.

Admission was therefore gated on a capability that does not exist and is
correctly reported missing. The product's primary flow was permanently
unavailable.

**Last successful create before the fix: 2026-08-28 20:28.**

Fixed by removing the predicate from both functions. The alternative — making the
worker report `true` — would be a lie in exactly the shape Task 3 exists to
remove. `private_networking_healthy` and `backup_healthy` are left in place:
both are genuinely measured against real infrastructure. When Task 9 builds real
health evidence, admission can gate on something actually measured.

### Why this was not caught earlier

The worker has published `monitoring_healthy: false` since `bf21d93`
(2026-08-20), yet creates succeeded on 08-27 and 08-28. Something changed the
balance between then and now, and **the exact trigger was not determined** —
worker deploy logs would settle it. What is certain is that the two halves are
individually reasonable and jointly fatal: an honest "no monitoring here" and a
gate that treats missing monitoring as a reason to refuse work.

## Fault 2: deleting an instance provisioned a new VM

The more serious one, and it was customer-facing.

`request_instance_deletion` (Task 4) ended with:

```sql
perform public.initialize_operation_stages(v_operation_id);
```

which seeds the ten **create-shaped** stages onto the delete operation. The
worker's generic stage machine claims any pending operation for its cluster and
walks those stages, and its `proxmox_api_call` branch only special-cases
`instance.snapshot`, `instance.resize` and `instance.restore_replace` — so
`instance.delete` fell straight through to the clone-a-new-VM path.

Observed on the disposable test instance, from the delete operation's own stage
history:

```
15:01:34  delete requested            instance -> deleting
15:01:37  preflight            done   {"needed_gb": 4, "available_gb": 7.07}
15:01:42  capacity_reservation done   reservation held
15:01:55  proxmox_api_call     done   {"vmid": 112}     <-- cloned a NEW VM
15:02:02  template_cloud_init  done   guildcloud-112.yaml
15:02:05  network_access_attach done
15:02:21  automated_verification done
15:02:24  ready                done   instance -> ready
15:02:23  operation                   state -> succeeded
```

The instance was left **running and `ready`**, pointing at a new VMID, with the
operation reporting success. Every customer-initiated delete would have left the
instance alive, provisioned an extra VM, held its capacity reservation, and said
it worked.

Deletion is not stage-driven — it is reconciled by the worker's
`processPendingInstanceDeletions` sweep, which finds instances in `deleting` with
an active delete operation, tears down Proxmox and Tailscale, then calls
`finish_instance_operation`. That sweep never needed stages. The other four
intents legitimately do, so the fix is to stop seeding them for this one kind
rather than to change `initialize_operation_stages`.

With no stages the stage machine's own guard already handles it: it looks for the
first pending/active stage in `STAGE_ORDER`, finds none, and returns
`no_pending_stage` without touching infrastructure. Stray stages on in-flight
delete operations were cleared by the same migration.

This shipped with Task 4 in PR #11, merged the same morning — so the exposure
was hours, not days, and the two clusters had no customer deletes in that window.

## The lifecycle test itself

Run in **Second Test Org / Sandbox** (chosen so no customer tenant carried test
rows), on guild-b/podF, instance `verify-t7-e2e`, `ubuntu-2404` / std-1.

| Step | Result | Evidence |
|---|---|---|
| Create | 56s | 10/10 stages, VMID 111 |
| Private access | ok | real Tailscale device, `100.106.53.113`, `instance-1142e8a0.tail345216.ts.net` |
| Snapshot | 44s | UPID `...qmsnapshot:111...` recorded in stage detail |
| Restore-replace | 51s | UPID `...qmrollback:111...`, correct snapshot, IP preserved |
| Resize std-1 → std-2 | 123s | observed vcpu 2 / 4 GB / 80 GB, boot disk `scsi0` |
| Downgrade guard | refused | "resize target must not reduce cpu, memory, or disk" |
| Delete | **fault 2** | see above |

Task 5's UPID-awaiting snapshot/restore and Task 6's monotonic verified resize
both did exactly what they were built to do, against real hardware. The resize
moved `catalog_plan_id` to `std-2` only after Proxmox confirmed the observed
resources matched the target — the check `finish_instance_operation` performs.

Cleanup after the fix: delete re-requested, **0 stages seeded**, sweep tore the
VM down. Instance row, snapshot row and capacity holds all gone; production back
to 7 instances, 0 active operations, 0 live holds.

**Not verified: whether VM 111 on podF was actually removed from Proxmox.** The
first (broken) delete's sweep should have taken it before the stage machine
repointed the instance at 112, but both Proxmox MCP servers were failing TLS
certificate verification at the time, so it could not be confirmed. Worth a
manual check for an orphaned guest on podF.

## CI had never passed

Worth recording separately, because it explains how two faults of this size
reached production on the same day. `npm ci` exited before any job reached a
test, on **every run since CI was introduced** in `a3b9744` — including the merge
to `main` and a docs-only PR. Two causes, both pre-existing: `@types/node` pinned
to exactly `22.10.7` against vite@8.2.2's `^20.19.0 || >=22.12.0`, and a
lockfile out of sync with `package.json`.

One detail worth not repeating: regenerating the lockfile with `node_modules`
already present produces a lock that installs in place but fails `npm ci`, **and
silently drops cross-platform optional dependencies** — 467 entries with 0 linux
and 1 `@next/swc`, which would install in CI and then fail at build time. A clean
resolve in a container holding only `package.json` gives 580 entries, 16 darwin,
54 linux, 8 `@next/swc`. Catching that needed an entry-count comparison, not an
install test.

## What this says about the gates

Neither fault was a subtle race. Both were reachable by the first person to try
the primary flow, and neither was caught by the pgTAP suites, because both live
in the seam between the database contract and the worker that consumes it: the
intent RPC seeds stages correctly *as a row*, and the stage machine walks stages
correctly *as a loop* — the two just disagree about what a delete means.

The plan's own Task 12 exists for this reason, and it earned its place today.
Its ordering — create, private access, snapshot, restore, resize, delete — is
also what surfaced the delete fault last rather than first, after the rest of the
lifecycle had already proven itself.
