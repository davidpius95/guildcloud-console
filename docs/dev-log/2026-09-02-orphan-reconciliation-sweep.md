# The sweep found something on its first working pass

**Date:** 2026-09-02
**Closes:** the "true orphans" gap left open by
`docs/decisions/2026-09-02-operator-cleanup-path.md`.

## Why it exists

The operator cleanup path can only act on instances the control plane knows
about. It had nothing to say about a guest that exists on a node with no
instance row at all -- which is what `iiiuuu` (119) and `coolify` (121) were on
podF. Nothing in the platform knew they existed. They were found by a human
reading a guest list, weeks after they were created. That is not detection.

## Shape

Each cluster's worker sweeps its own PVE pool, reports what it cannot account
for, and destroys only what an operator has explicitly approved. Detection and
destruction are separate because a false positive here is unrecoverable and the
population being scanned includes the platform's own templates and the worker's
own container.

Pool membership is the boundary, **not tags**. Guild-B's nodes carry plenty of
non-GuildCloud workloads, and `wazuh` (vmid 130) carries the `guildcloud` tag
while belonging to no pool -- almost certainly because it was once cloned from a
GuildCloud template by hand. Matching on tags would have proposed reaping it.

Excluded explicitly, each for a reason that would have bitten:

| Excluded | Why |
| --- | --- |
| templates | every instance is cloned from the per-node `ubuntu-2404-guildvm-template-*` guests |
| non-QEMU guests | the worker's own LXC is a pool member; reaping it destroys the control loop, including whatever was doing the reaping |
| warm-pool VMs | real guests with no instance row -- they reach the sweep through the known set, or every pass would propose reaping the warm pool |

Approval additionally refuses a guest seen in only one sweep, since it may have
been mid-provision when the sweep ran. Dismissal requires a note, because a
silent dismissal is indistinguishable from an oversight.

## Two faults found by probing rather than by reading

The first deploy reported nothing, and nothing was also the correct answer --
all four known orphans had already been removed. Silence proved nothing. So a
disposable guest (`orphan-sweep-probe`, vmid 150, no disk, never started) was
created in guild-b's pool with no instance row.

It was not flagged, and the worker log said why on every cycle:

```
Proxmox GET pools/guildcloud-guild-b -> 403:
Permission check failed (/pool/guildcloud-guild-b, Pool.Audit)
```

**Fault 1 -- the pool read.** Switched to `cluster/resources`, which carries the
same `pool` field and needs no new privilege. That is also the safer failure
mode: if the token can ever see less, the candidate list shrinks rather than
grows, which is the right direction for something whose output authorises
destruction. A guard was added at the same time -- an empty pool is not a real
state, since the templates and the worker are always members, so the sweep now
skips and says so rather than reporting an empty list and resolving every open
finding as though the guests had vanished.

**Fault 2 -- the permission was the real cause anyway.** `cluster/resources`
also hides the `pool` field without `Pool.Audit`, so the guard fired instead:

```
orphan_sweep_skipped: no pool members visible; refusing to treat this as an empty pool
```

The cause is a Proxmox subtlety worth writing down. The worker already holds
`PVEAuditor` on `/`, and **PVEAuditor includes `Pool.Audit`**. But a more
specific ACL path in Proxmox *overrides* rather than unions, so the
`GuildCloudSiteWorker` entry on `/pool/guildcloud-<cluster>` masked the
inherited auditor role entirely. The role itself had no `Pool.Audit`, so on the
one path where it mattered, the worker had none.

`Pool.Audit` was added to `GuildCloudSiteWorker` on both clusters -- a read
privilege, on a role that already holds `VM.Allocate`, scoped by existing ACLs
to the cluster's own pool. `docs/REPLICATION.md` now carries it, with the
override note, so a rebuilt cluster does not reproduce the fault.

## Verified end to end

| Step | Result |
| --- | --- |
| Sweep detects the probe | `orphan_guests_reported count=1 vmids=[150]` |
| Observation count rises across sweeps | 1 -> 3 |
| Approval authorises the cluster's own worker | `approved_for_reap_at` set |
| Worker destroys it | `orphan_guest_reaped ... destroyed=true` |
| Finding closed | `reaped_at` and `resolved_at` set |
| podF re-read | vmid 150 gone |
| Everything else | templates, worker LXC, `yrt`, `Trsy` never flagged |

## And a real finding, unplanned

On its first working pass the sweep flagged something nobody had planted:

**`pool-100`, vmid 100, guild-a/nodeD, running.**

It carries the warm-pool naming convention (`pool-<vmid>`), sits in the
GuildCloud pool, and has **no `warm_pool_vms` row** -- the only warm-pool records
are vmids 254234 and 710637. So it is an orphaned warm-pool VM whose
control-plane record was lost, running since roughly the template era and
holding 2 vCPU and 2 GB on nodeD with nothing pointing at it.

It has deliberately **not** been reaped. It is running, it is the operator's
infrastructure, and the entire design of this feature is that a human decides.
It sits as an open finding, which is the product working as intended -- and it is
the first thing the platform has ever found on its own rather than by someone
noticing.

## Still open

- **No console surface.** Findings are reachable through
  `scripts/operator-cleanup.mjs orphans`. Deliberate; see the decision record.
- **`platform_operators` is empty.** Approving through the supported path needs
  an operator row, added out of band. The probe's approval was set directly for
  verification, which exercises the worker half but not the operator RPC -- that
  half is covered by pgTAP rather than in production.
- **Only orphan guests.** Orphaned tailnet devices, snippets and capacity
  reservations are the same class of problem and are not swept.
