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

`Hjj` (105) and `Hjj-restored` (106) **could not be removed from this account**.
They belong to organization `GuildTech`, not the signed-in `GuildCloud HQ`, so
RLS correctly 404s their console pages -- which is the tenant isolation working
as designed. Removing them needs a GuildTech member, or a deliberate operator
action. They were left in place rather than reached around with a direct Proxmox
delete, because destroying another tenant's guests is not something to do
sideways.

This is worth noting as a product gap in its own right: **an operator has no
supported way to clean up a tenant's abandoned infrastructure.** Today the only
routes are "ask the customer" or "bypass RLS".

## Also on podF, unrelated to failed creates

`iiiuuu` (119) and `coolify` (121) sit in the `guildcloud-guild-b` pool with **no
instance row at all** -- true orphans, not abandoned clones. They predate this
work (called "two legacy guests" in the 2026-08-29 entry) and nothing in the
control plane knows about them. They are stopped, so they cost disk rather than
CPU. Left alone deliberately; someone should confirm what they were before
deleting them.
