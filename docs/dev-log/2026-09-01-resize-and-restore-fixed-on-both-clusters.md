# Resize and restore, fixed and verified on both clusters

**Date:** 2026-09-01
**Follows:** `2026-09-01-resize-and-restore-tested.md`, which found resize
broken and unrecoverable. This is the fix, and the end-to-end proof on
**both** Guild-A and Guild-B.

**Result: create, resize, snapshot and restore all work on both clusters.**

## Why the cluster mattered

The original failure reproduced on guild-a and not guild-b, and that was the
whole clue. Guild-A's `ceph-vm` is slow -- a single instance showed cumulative
write service times in the *thousands* of seconds. Guild-B is on `local-lvm`.
Every timing assumption in the restart path was tuned, accidentally, to the fast
cluster. Which cluster placement happened to pick decided whether a resize
worked.

Two separate timeouts had to be fixed, and the second was only visible once the
first was gone.

### Fault 1 -- the restart raced a lock instead of waiting for it

```
can't lock file '/var/lock/qemu-server/lock-102.conf' - got timeout
```

Proxmox holds that lock for the duration of the preceding disk grow. The restart
was four attempts three seconds apart -- about twelve seconds, against a lock
Guild-A holds for minutes.

`restartInstanceAfterConfigChange()` now polls `status/current` for the `lock`
field and waits it out, retrying transient lock errors with exponential backoff
on a five-minute budget, while failing fast on anything that is *not* a lock so a
real fault is not buried in a long timeout.

### Fault 2 -- the reboot task outran its own wait

With the lock waited out, guild-a got further and hit:

```
Proxmox task UPID:...:qmreboot:102 did not finish within 120000ms
```

`waitForTask` defaults to 120s; a qmreboot on this storage routinely exceeds it.
The task had not failed -- the wait had. Worse, the instance went `degraded`
**with the VM powered off**, so the customer's server was down as well as stuck.

The restart now passes `waitForTask` the budget it actually has, and treats
`did not finish within` as transient. A task Proxmox *reports* as failed is still
terminal. The confirmation loop additionally requires the **uptime to have
reset** before calling a reboot successful -- without that, "still running" would
pass for a reboot that never happened, reporting success while the new cores and
memory were not in effect. A VM found stopped is started and re-confirmed, which
is what recovered the powered-off instance.

### Fault 3 -- failure was a one-way door

`finish_instance_operation` sets a failed operation's instance to `degraded`, and
`request_instance_resize` / `_snapshot` / `_restore_replace` all required
`state = 'ready'` exactly. So every recovery route returned `instance is busy`
and deletion was the only remaining action, on a server whose config had already
been changed.

`20260901120000_allow_recovery_from_degraded.sql` widens those three guards to
admit `degraded`. Widened, not removed: provisioning, resizing and deleting
instances are still refused, and `operations_one_active_per_instance_idx` still
allows only one operation at a time. Both halves are covered by pgTAP.

## Fault 4, found on the way: Guild-B could not deploy at all

Verifying the rollout showed Guild-B **frozen on a 2026-08-29 release**, rolling
back every attempt:

```
ROLLED_BACK reason=health commit=cc42cdc... rollback_target=.../20260829T222030Z
```

`deploy-pull.sh` runs `node index.js --health` with no environment. Since TLS
verification was enabled that needs `NODE_EXTRA_CA_CERTS` from the worker env
file, and only `guildcloud-worker.service` has an `EnvironmentFile`. So every
release failed its own health gate and reverted -- **while the worker kept
running and reporting healthy**, which is why nothing surfaced it. Reproduced
exactly by running the gate's own command with an empty environment:

```
proxmoxApiReachable: false, proxmoxApiError: "fetch failed"
```

`deploy-pull.sh` now sources the worker env before the gate, and the deploy unit
gains an optional `EnvironmentFile`. The running copy at
`/opt/guildcloud-worker/deploy-pull.sh` does **not** self-update, so Guild-B was
patched by hand once; it then reached `DEPLOYED` on its own.

This means Guild-B had been silently running month-old worker code. Anything
merged between 2026-08-29 and today only ever ran on Guild-A.

## Verified end to end, on production, on both clusters

| | Guild-A (nodeA, ceph-vm) | Guild-B (podB, local-lvm) |
| --- | --- | --- |
| Create disk = plan size | 40G | 40G |
| Guest filesystem grown | yes | yes (38G, then 77G after resize) |
| Resize std-1 -> std-2 | **succeeded, 144s** | **succeeded, 54s** |
| Applied on Proxmox | 2 vCPU / 4 GiB / 80 GiB, running | 2 vCPU / 4 GiB / 80 GiB, running |
| VM actually restarted | yes (uptime reset) | yes (uptime reset) |
| Snapshot | succeeded | succeeded, 26s |
| Restore | **succeeded, 192s** | **succeeded, 100s** |
| Marker written after snapshot | **gone after restore** | **gone after restore** |
| Private IP / hostname | preserved | preserved |
| Recovery from `degraded` | **accepted** (was `instance is busy`) | n/a |

The Guild-A run is the strongest evidence: that instance was left `degraded` and
**powered off** by the old code, and was recovered through the product -- resize
re-requested from the console, VM started, resources applied, then snapshotted
and restored, with the post-snapshot marker file confirmed gone afterwards.

Both test instances (`rs-test-a`, `rs-test-b`) were deleted through the real UI
teardown flow afterwards.

## Still open

1. **Nothing verifies post-boot that the guest filesystem matches the plan.**
   Growth is confirmed at the Proxmox layer only. `automated_verification` is the
   natural home for a `df` check.
2. **The existing fleet is still undersized.** The create fix applies to new
   instances. Remediating older ones by resizing is now safe -- that was the
   blocker in the previous entry and it is fixed -- but it has not been done, and
   each resize restarts the server.
3. **An unhandled throw still kills a whole worker cycle** rather than failing
   one operation (`index.js:2350`). Unchanged from the previous entry.
4. **Guild-A's storage is the real constraint.** Provisioning there took 502s
   against Guild-B's 115s, and both timeouts fixed here were symptoms of it.
   Worth investigating ceph-vm write latency on its own merits rather than only
   widening timeouts around it.
5. **No alerting** on a worker that cannot deploy. Guild-B rolled back silently
   for days and reported healthy throughout.
