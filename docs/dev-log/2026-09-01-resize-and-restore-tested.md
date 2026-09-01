# Resize and restore, tested end to end

**Date:** 2026-09-01
**Scope:** exercise resize and restore through the production console, on real
instances, and verify the result on Proxmox rather than in the UI alone.

**Result: restore works and is correct. Resize is not safe to expose.** Two
defects found, one of them customer-facing on every instance ever created.

## Summary

| Operation | Result | Time |
| --- | --- | --- |
| Create (guild-b/podB) | works | 63-97s |
| Create (guild-a/nodeA) | works, much slower | ~325s |
| Snapshot | works, real Proxmox snapshot | 26s |
| Restore | works, verified at data level | 101s |
| Resize | **failed, left instance unrecoverable** | failed at 231s |

## Restore — works, and genuinely rolls the disk back

Tested on `e2e-restore` (guild-b/podB, VM 108) with a real proof rather than a
status check:

1. Snapshot taken through the UI → real Proxmox snapshot
   `snap-ba5b7e544bf045ad9cc4` confirmed via the Proxmox API.
2. A marker file `/root/RESTORE-MARKER.txt` was written **after** the snapshot,
   via the guest agent.
3. Restore run through the UI.
4. Post-restore check via the guest agent: `MARKER GONE - disk rolled back
   correctly`, VM rebooted at 16:09:52, hostname still `e2e-restore`.

Network identity survived the rollback: same private IP `100.71.6.27`, same
hostname `instance-7cf9404a.tail345216.ts.net`. The instance returned to `ready`.

The UI around it is honest and well-gated:

- **Restore is disabled until a snapshot exists** — verified: greyed out on a
  fresh instance, enabled after the snapshot.
- The dialog names the actual Proxmox snapshot id, warns "Destructive: the
  current disk state is discarded after the snapshot rollback succeeds", and
  requires typing the instance name. The confirm button stays disabled until the
  typed text matches.

## Resize — broken, and it strands the instance

Tested on `e2e-lifecycle` (guild-a/nodeA, VM 102), Standard 1 -> Standard 2.

The dialog is good: it lists plans, prices the change live ($11.52 -> $22.32),
says "disk shrinking is not offered", warns that applying restarts the server,
and keeps confirm disabled while the current plan is selected.

The apply is where it breaks. Proxmox config was updated correctly —
`cores 1 -> 2`, `memory 2048 -> 4096`, `scsi0 16G -> 80G` — and then:

```
Failed to reboot/start VM 102 after config update:
Proxmox task failed: can't lock file '/var/lock/qemu-server/lock-102.conf' - got timeout
```

The reboot retry budget is four attempts three seconds apart, about twelve
seconds total (`deploy/site-worker/index.js:1493-1513`). On guild-a's `ceph-vm`
storage the preceding 64 GiB disk grow is slow — the VM showed cumulative write
service times in the hundreds of seconds — and the qemu-server config lock was
still held. Twelve seconds is not a meaningful retry window against that.

### The part that matters: there is no way out

The operation failed, so `finish_instance_operation` set the instance to
`degraded` (`supabase/migrations/20260829110000_add_atomic_instance_intents.sql:437`).
Both `request_instance_resize` and `request_instance_snapshot` require
`state = 'ready'` exactly (lines 224 and 162) and otherwise raise
`instance is busy`. Confirmed live in the console:

- Retry resize -> **"Failed to resize: instance is busy"**
- Take a snapshot -> **"Failed to create snapshot: instance is busy"**
- Restore -> unavailable (no snapshot exists, and one cannot be taken)
- Delete -> the only action that still works (`degraded` is in its allowed set,
  line 360). Verified: the degraded instance deleted cleanly.

So a customer whose resize hits this loses the ability to resize, snapshot or
restore, and their only self-service option is to destroy the server. Nothing
reconciles it: the instance sat `degraded` for 18 minutes with no recovery.

The resulting state is also inconsistent. Proxmox had 2 vCPU / 4 GB / 80 GB
applied while `catalog_plan_id` stayed `std-1` and the console chip still read
"Standard 1 (1 vCPU · 2 GB RAM)". The running VM still had 1 vCPU / 2 GB because
the reboot never happened, so config, billing and reality disagreed three ways.

## Second defect: created instances get the template's disk, not the plan's

Found while capturing the pre-resize config, and it is independent of the resize
bug. `catalog_plans` advertises:

| plan | vcpu | memory | disk |
| --- | --- | --- | --- |
| std-1 | 1 | 2 GB | **40 GB** |
| std-2 | 2 | 4 GB | **80 GB** |
| std-4 | 4 | 8 GB | **160 GB** |
| std-8 | 8 | 16 GB | **320 GB** |

Every instance is created with the **template's 16 GiB** boot disk regardless of
plan. `instance.create` never grows it. Evidence:

- `e2e-lifecycle`, std-1 (40 GB advertised): `scsi0 ... size=16G` at create.
- `e2e-01sep-c`, std-2 (80 GB advertised): `maxdisk` 17179869184 = 16 GiB.
- `Trsy`, std-1, created 2026-08-27, never resized: 16 GiB.
- `yrt`, std-4: 160 GiB — **because it was resized** after creation
  (`instance.create` then `instance.resize` in its operation history).

Only `resizeInstanceResources` applies the plan's disk size
(`deploy/site-worker/lifecycle.js:80-118`), and it computes growth as
`expected.disk_gb - diskGb`, which is why the resize correctly took 16G to 80G.
The create path has no equivalent step.

Customers are therefore billed for 40-320 GB and given 16 GB, on every instance
in the fleet, and the console's own plan chip and create summary state the
advertised figure. This is the more serious of the two findings.

## Recommendations

1. **Fix the create disk size.** Apply the plan's `disk_gb` during
   `instance.create`, the same way resize does. Audit existing instances — every
   one not resized is undersized.
2. **Do not leave resize reachable as-is.** Either gate it behind the fix below
   or disable it in the console until the failure is recoverable.
3. **Make the reboot robust**: retry against the actual lock, with a budget
   matched to slow storage (minutes, not seconds), and treat "lock held" as
   retryable rather than terminal.
4. **Add a recovery path out of `degraded`.** Either allow resize/snapshot to be
   re-requested from `degraded`, or add a reconciler that re-drives the pending
   reboot and returns the instance to `ready`. Today `degraded` is a one-way door
   to deletion.
5. **Never leave config, plan and reality disagreeing.** If the reboot fails,
   either roll the config back or record the applied spec, so billing and the UI
   do not claim a plan that is not in effect.

## Third finding: an unhandled throw kills the whole worker cycle

While the `degraded` instance was being deleted, the guild-a worker crashed:

```
Error: Operation bf70df76-614b-46e6-b229-e355bc4d762a has no runnable stage and was not finalized
    at run (file:///opt/guildcloud-worker/releases/20260830T152405Z/index.js:2350:15)
guildcloud-worker.service: Main process exited, code=exited, status=1/FAILURE
```

The operation was an `instance.delete` that reached a state with no runnable
stage. Rather than failing that one operation, the throw propagates out of `run`
and terminates the entire bounded cycle, so every other operation the worker
would have handled in that cycle is dropped.

It is not a permanent poison pill — the timer fired again two minutes later and
the delete completed (`succeeded` at 16:15:49). But the blast radius is wrong:
one malformed operation stalls all work on that cluster for a cycle, and on a
cluster with real customer load that is an outage window, not a hiccup. It also
explains why the delete appeared stuck as `pending` for over two minutes.

**Recommendation:** catch per-operation errors inside the cycle loop, mark that
operation failed, and continue with the rest.

## Smaller UI issues

- A failed *resize* renders as "Provisioning stopped" with the create timeline
  reset to 0/10 and every stage "Pending", which describes something that did not
  happen — the server was up and reachable throughout. Same root cause as the
  delete-banner issue noted on 2026-09-01: the detail page reuses the
  provisioning timeline for non-create operations.
- Resize and Snapshot buttons stay clickable on a `degraded` instance and open
  fully populated dialogs, only failing on submit. They should be disabled with
  the reason shown.
- Guild-A provisioning took ~325s against guild-b's ~65s, traced to slow
  `ceph-vm` write latency. Not a fault, but it is what makes the resize reboot
  race fire on guild-a and not guild-b.

## Test artifacts

`e2e-lifecycle` (guild-a/nodeA VM 102) and `e2e-restore` (guild-b/podB VM 108)
were both created and deleted through the real UI. Both are gone from the
`instances` table and from their nodes' guest lists.
