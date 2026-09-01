# Failed creates no longer abandon their clone

**Date:** 2026-09-02
**Closes:** the "failed creates leave orphan VMs" item carried since
`2026-09-01-resize-and-restore-tested.md`.

## The bug

The clone happens early in `instance.create`. If any later stage failed -- a
snippet write, a tailnet join, the verification -- the operation was marked
failed and the guest was simply left behind: running or stopped on the node,
holding CPU, memory and disk, with nothing pointing at it but a `failed` row the
customer had to notice and delete by hand. There was no compensating action at
all.

podF was still carrying `Hjj` (105) and `Hjj-restored` (106) from 2026-08-27 for
this reason, and `yut` (102) joined them on 2026-09-01.

## The fix

`processOneStage` now rolls the clone back before finalizing a failed
`instance.create`: destroy the guest, delete its cloud-init snippet, clear
`proxmox_vmid`.

Scoped to creates on purpose. An instance that never reached `ready` was never
reachable and holds no customer data. Resize and restore are excluded -- those
VMs are live and have data, and destroying one on a failed operation would be
the worst possible response.

The rollback can never mask the real failure: if it throws, that is logged and
the original error is still what gets recorded against the operation.

### Clearing the vmid is the part that matters most

Proxmox reuses vmids. A `failed` row still naming a destroyed guest is a live
hazard, not untidiness: a later delete resolves `node + vmid`, so once that id is
reissued the delete would target **whatever now holds it on that node** and
destroy an unrelated customer's server. The existence check added on 2026-09-01
makes that *more* likely to fire, not less, because it proceeds when a guest is
present.

That could not be expressed before. `worker_update_instance_runtime` patched with
`coalesce(new, old)`, so a null meant "leave alone" and no column could ever be
cleared -- while the non-boundary path it replaced (`update(patch)`) has always
set nulls. The two disagreed about what a null in the patch means, which only
mattered once something needed to clear a value. `20260902090000` aligns them: a
key present in the patch is applied including null, a key absent is left alone.
Every existing caller passes only keys it intends to set.

`destroyGuest` lives in `lifecycle.js` so it is testable, and asks whether the
guest is present rather than inferring it from an error -- Proxmox answers a
DELETE for a missing vmid with 403, not 404.

## Verification

Three worker tests (destroy, already-gone, missing node/vmid) and seven pgTAP
assertions (set, explicit-null clear, absent-key-left-alone, alongside the
existing whitelist guards that still refuse `catalog_plan_id`,
`organization_id` and `state`). Full gate green; live on both clusters as
`ddf47d5`.

**Not exercised by a real failed create.** The failures that used to produce
these orphans -- ENOSPC, the lock race, the reboot timeout -- are all fixed, so
there is no natural failure left to trigger it, and manufacturing one would have
meant breaking production. The rollback path is unit-tested, not
production-proven. Worth revisiting the next time a create genuinely fails.

## Cleanup, and what could not be cleaned up

`yut` (102) was deleted through the console; podF's guest list confirms it gone.

`Hjj` (105) and `Hjj-restored` (106) could not be removed through the console:
they belong to organization `GuildTech`, not the signed-in `GuildCloud HQ`, so
RLS correctly 404s their pages -- tenant isolation working as designed.

That org is owned by a **different account**, `guildtechnology0@gmail.com`, and
it also owns `Trsy` (110), which is running. Both facts were established and put
to the operator before anything was touched, rather than treating "a different
org" as a detail. The operator confirmed they control that account and asked for
an operator-level cleanup, which is what follows.

**Removed 2026-09-02.** Checked first, same as the legacy pair:

| | `Hjj` (105) | `Hjj-restored` (106) |
| --- | --- | --- |
| State | stopped, `failed` | stopped, `failed` |
| Disk | `local-lvm:vm-105-disk-0`, 16G | `local-lvm:vm-106-disk-0`, 16G |
| Proxmox snapshots | none | none |
| PBS backups | **4, newest 2026-09-01** | **4, newest 2026-09-01** |
| `cicustom` | none | none |
| Tailnet device | none recorded | none recorded |

Two differences from the 119/121 pair are worth keeping straight. These **do**
have PBS backups, so the deletion is recoverable by restore rather than final.
And neither carried a `cicustom` at all -- consistent with both having failed at
`template_cloud_init`, before a snippet was ever attached -- so again there was
nothing to clean up there.

Because the console path was unavailable, the guests were destroyed through the
Proxmox API and the control-plane rows removed directly. **The second half is
not optional.** Destroying the guests alone would have left two `failed` rows
naming vmids 105 and 106 on podF -- precisely the stale-vmid hazard the
compensating action above exists to prevent, and one that gets worse as soon as
podF reissues those ids. The delete was scoped by instance id *and*
organization *and* state *and* vmid, so it could not widen to `Trsy`, and it
removed the dependent `operations` and `capacity_reservations` rows in the same
transaction: 2 instances, 2 operations, 2 capacity reservations.

Verified afterwards: both destroy tasks returned `exitstatus: OK`; podF's guest
list and `local-lvm` content carry no `vm-105-*` or `vm-106-*` volumes; `Trsy`
(110) is still running with five days of uptime and its tailnet device intact.
About 32 GiB reclaimed, on top of the 32 GiB from the legacy pair.

The product gap this exposed stands regardless, and is the thing worth fixing:
**an operator has no supported way to clean up a tenant's abandoned
infrastructure.** Today the only routes are "ask the customer" or "go around RLS
with service-role access", and the second is only safe if you also remember to
delete the rows -- which is exactly the kind of two-step nobody remembers under
pressure.

## Also on podF, unrelated to failed creates -- now removed

`iiiuuu` (119) and `coolify` (121) sat in the `guildcloud-guild-b` pool with **no
instance row at all** -- true orphans, not abandoned clones. They predated this
work (called "two legacy guests" in the 2026-08-29 entry) and nothing in the
control plane knew about them.

**Deleted 2026-09-02**, on the operator's instruction, after checking what they
were rather than trusting the name:

| | `iiiuuu` (119) | `coolify` (121) |
| --- | --- | --- |
| State | stopped | stopped |
| Disk | `local-lvm:vm-119-disk-0`, 16G | `local-lvm:vm-121-disk-0`, 16G |
| Snapshots | none | none |
| PBS backups | none | none |
| `instances` / `warm_pool_vms` / `operations` rows | none | none |
| `cicustom` | shared `local:snippets/tailscale-vendor.yaml` | same |

Both carried the same operator SSH key and a `ctime` matching the podF template
seeding, so they read as manual test VMs from that session.

Two things were worth checking before pressing delete. The `cicustom` on each
points at the **shared** `tailscale-vendor.yaml`, not a per-instance
`guildcloud-N.yaml`, so there was no snippet to clean up and nothing to remove
that another guest still references -- the mistake that made VMs permanently
unstartable on 2026-08-29. And `coolify` is an ambiguous name: a *different*,
**running** `coolify` (123) lives on podA with six days of uptime. Only podF/121
was destroyed; 123 was re-read afterwards and is untouched.

There were no backups of either, so this was irreversible -- the disks are gone,
not archived. Their configs are recorded above, which is the only thing that
survives. Destroy tasks returned `exitstatus: OK`; podF's guest list and
`local-lvm` content were both re-read afterwards and carry no `vm-119-*` or
`vm-121-*` volumes. About 32 GiB reclaimed.

podF now holds only `Hjj` (105) and `Hjj-restored` (106) -- the GuildTech
abandoned clones this account cannot reach -- plus the live `yrt` (107) and
`Trsy` (110), and the node template.
