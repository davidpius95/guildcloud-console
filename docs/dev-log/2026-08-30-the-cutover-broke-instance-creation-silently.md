# 2026-08-30 — the worker cutover broke instance creation, silently, for nine hours

Found while answering an ordinary question: *does creating an instance still
work?* It did not, and had not since the previous evening.

## What was observed first

Two instances sitting in `provisioning`, created 22:28 and 23:04 the night
before, still `provisioning` at 08:00. Their operations were `pending`,
`current_stage` null, `updated_at` never advanced past `started_at`. The last
operation this platform completed was a delete at **19:18**.

Both workers were healthy the whole time: heartbeats seconds old, capacity
published a minute earlier, `admission_state` open on both clusters. Nothing
alerted, nothing logged, and the dashboards a person would check all looked
correct.

## The mechanism

`claimPendingOperations()` did two things. It placed unplaced operations through
the boundary RPC — which worked. Then it listed the operations to execute:

```js
const { data: ops } = await supabase
  .from("operations")
  .select(...)
  .eq("cluster_id", config.clusterId)
  .in("state", ["pending", "running"])
return ops ?? [];
```

Task 7 left `guildcloud_site_worker` with **zero table privileges**, deliberately.
Verified in production: `total_table_grants: 0`. So that read was denied.

The call destructured only `data`. `error` was dropped on the floor. A permission
denial therefore arrived as `null`, `ops ?? []` made it an empty array, and the
worker concluded it had no work to do — without logging anything, because there
was no error variable to log.

That is the whole outage. Not a crash, not a failed request: a denial converted
into "nothing to do".

## Why it stranded instances rather than just delaying them

`place_next_pending_operation` selects `where ... cluster_id is null`. Once an
operation has been placed it is invisible to placement forever.

So each create followed this path: placed, `cluster_id`/`assigned_node`/
`storage_id` written, a 15-minute capacity reservation held, `preflight` and
`capacity_reservation` stages marked done — and then dropped, because the listing
that would have executed it returned nothing. On the next tick placement skipped
it (already placed) and the listing still returned nothing.

Measured in production:

```
pending_creates: 2   visible_to_placement: 0   orphaned_forever: 2
```

Every create attempt during the window permanently stranded an instance and
leaked a capacity reservation. The customer-visible state was `provisioning`,
indefinitely.

## Why deletions kept working, and why that mattered

Deletions go through `worker_list_pending_deletions()`, a real boundary RPC.
Creates were the only path still depending on a table read. The worker client
had `claimNextOperation`, `getOperation`, `startStage`, `listPendingDeletions` —
and no method to list a cluster's operations at all.

That asymmetry is why this looked fine from outside. Deletes succeeded, workers
heartbeated, capacity refreshed. Only the one path was dead.

## The test that was supposed to catch it

`single-source.test.js` contained a test whose own comment states the intent
exactly:

> The database role has no table privileges, so an unguarded `.from()` would fail
> at runtime in worker_token mode — on whatever production cluster ran it first.
> Catch it here instead.

It scanned the 18 lines above each `.from()` for the string `controlPlane` and
called the site guarded if it appeared. Run against the real file, it reported
**all 42 call sites as guarded**, including the broken one — the word appears
just above it, in the placement branch that guards something else entirely.

A check that passes on every input is not a check. It was green throughout the
outage.

## The fix

**`worker_list_cluster_operations(p_limit)`** (migration `20260830090000`) — the
missing listing, as an RPC. Cluster resolved from `worker_identities` via
`current_worker_cluster()`, never from the caller. Returns everything the worker
needs to execute (`assigned_node`, `storage_id`, `stages`), so it has no reason
to reach for the table again.

**The error is no longer swallowed.** Both the boundary call and the legacy read
now log on failure. A worker that cannot see its own work is broken, and silence
is what made this invisible.

**`sealTableAccess()`** — on the worker_token path the client is wrapped so any
`.from()` throws immediately, naming the table and pointing at the RPC to use
instead. Every legitimate `.from()` in the worker sits in an `else` branch that
runs only when `controlPlane` is null, so reaching one on the boundary path is
unambiguously a bug. This is the same invariant the deleted text-scan was aiming
at, enforced where a regex cannot be fooled.

**The vacuous test is gone**, replaced by two that can actually fail: one
asserting the worker_token path returns the sealed client (and that the legacy
path does *not* get sealed, since its table access is legitimate), one asserting
the listing goes through the boundary and does not destructure only `data`. Both
were mutation-tested — reintroducing either half of the bug fails them.

Coverage added: 5 behavioural tests for the seal, 6 pgTAP assertions on the new
RPC (own-cluster only, revoked worker rejected, bad limit rejected, payload
complete enough to execute without a table read).

## Two more bugs, found by fixing the first

Restoring the listing let the worker reach code it had not executed since the
cutover. Two latent faults surfaced within minutes of the fix deploying, both
invisible until then.

**`worker_get_operation` returned stage names instead of stage rows.** The
aggregation aliased `operation_stages` as `stage`, which is also a column on
that table; Postgres resolves the ambiguity to the column, so `to_jsonb(stage)`
serialised the name. The RPC returned `["template_cloud_init", ...]`, so
`processOneStage` built its map on `s.stage` of a string, matched nothing, and
returned `no_pending_stage` -- which the caller treats as unrecoverable and
throws. The Guild-B worker crash-looped on the first operation it had been able
to see in fifteen hours, exiting non-zero every cycle and taking every other
operation on that cluster with it. Fixed in `20260830100000` by renaming the
alias. Checked the other five `to_jsonb(alias)` sites in the schema: none of
those tables has a column matching its alias, so this was the only one.

**An unguarded `.from("instances")` at the top of every stage.** Same shape as
the original bug -- `const { data: instanceForTarget }`, error discarded. On the
boundary path it silently returned undefined, so lifecycle operations fell back
to whatever the operation carried rather than the instance's own stored
placement. It now goes through the guarded `getInstance()` helper.

The second one is worth dwelling on: **the seal found it, in production, exactly
as designed.** Instead of another silent empty result, the operation failed with
`Table access "instances" on the worker_token path` recorded as its failure
reason, naming the table. That is the difference between a bug you find and a
bug that costs fifteen hours.

A subsequent audit of every `.from()` call site found one more of the same kind
-- `warmPoolDetail` reading `operation_stages` unguarded, which would have made
every later stage conclude a create did not come from the warm pool and
provision over a claimed VM. Fixed before it could fire.

## Still outstanding

**The two stranded instances are now `failed`, not stranded.** No requeue was
needed and none was done: the new listing selects `cluster_id = mine and state
in (pending, running)`, which already matched them, so clearing `cluster_id`
would only have discarded a valid placement. The worker picked them up on its
own once the listing was fixed, advanced them, and failed them honestly on the
unguarded-read bug above. They now need re-creating from the console rather than
requeuing -- a customer-visible `failed` with a reason is a better resting state
than `provisioning` forever, but it is still not a created instance.

**One bad operation can halt a whole cluster.** `no_pending_stage` throws out of
the run loop rather than failing just that operation, so a single malformed
operation stops every other one on the cluster. That is what turned this bug into
a crash loop. Worth making per-operation rather than fatal.

**Placed-but-unstarted operations have no reconciliation path.** This fix stops
new ones being created, but the structural gap remains: nothing sweeps an
operation that was placed and then abandoned. Task 5 covers stranded `running`
operations, not stranded `pending` ones. Worth folding into that task.

**`monitoring_healthy` is false on both clusters** and has been throughout. It is
honest — no monitoring system exists to query yet — but it means any future gate
on it will refuse all work, which has already caused one outage (2026-08-29).
