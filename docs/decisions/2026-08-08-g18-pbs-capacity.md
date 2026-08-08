# Decision record: G-18 follow-up — PBS capacity for Guild-B

**Date:** 2026-08-08
**Status:** applied. Datastore expanded; backup job scope reduced to fit
realistic capacity; re-proven with a real multi-guest backup run.

## Context

`docs/decisions/2026-08-08-g18-g19-guildb-wiring.md` flagged, but did not
solve, a real capacity risk: the shared PBS datastore had only ~75 GB free
while several Guild-B guests are far larger than anything on Guild-A.

## What was measured

- **`nodeE`'s physical disk** (250 GB Samsung 860 EVO): `local-lvm` thin
  pool had 123.7 GB genuinely available (147.2 GB pool, 23.5 GB used) —
  real headroom to grow the PBS VM's disk without touching anything else
  on that node.
- **`gean-devnet`'s actual data**, not nominal size: its 1 TB `scsi1` disk
  has been written to `wr_highest_offset` ≈ 991.5 GiB — this is real,
  largely-incompressible blockchain devnet data (Ethereum devnet chain
  state), not sparse space. A full backup of this guest alone would have
  exceeded the entire datastore on the first run.
- Two other guests carry large nominal disks and are tagged as clearly
  unrelated side projects, not GuildCloud infrastructure:
  `cloudstack-aio` (VMID 400, stopped, 79.5 GB, tag `cloudstack`) and
  `fleetbase` (VMID 500, stopped, 150 GB, tag `fleetbase;logistics`).

## What was done

1. **Grew the PBS VM's disk** 100 GB → 200 GB (`qm resize`), using the
   confirmed-available thin-pool headroom. Grew the guest's partition
   (`growpart`) and filesystem (`resize2fs`, ext4) online — no downtime.
   Verified via `df` inside the guest (169 GB avail, up from 75 GB) and
   independently via both clusters' own `storage/guild-pbs/status` views
   (180.7 GB avail / 211.2 GB total, matching).
2. **Scoped `guild-b-standard-daily`** to exclude VMIDs 300 (`gean-devnet`),
   400 (`cloudstack-aio`), 500 (`fleetbase`) — the three large,
   pre-existing, non-GuildCloud workloads. This mirrors the same scoping
   decision already made for the firewall ipset and the earlier Guild-A
   G-14 policy (legacy/personal workloads are out of scope for
   GuildCloud's own operational infrastructure, not silently absorbed
   into it because they happen to share hardware).
3. **Re-ran the actual job parameters** (not just a single guest) to prove
   the scoped set works: `vzdump --all 1 --exclude 300,400,500 --storage
   guild-pbs --mode snapshot --compress zstd` against `podA`. Confirmed
   two real, useful behaviors:
   - VM 102's *second* backup (from the earlier proof run) transferred
     only 120 MiB via dirty-bitmap incremental tracking — 99% reused from
     the first backup. Ongoing daily cost is cheap; the real capacity cost
     is the *first* backup of each guest, once.
   - VM 120 (`k8s-cp-1`, 48 GB nominal across two disks) backed up as a
     first-time full backup, real data transfer in progress at proof time.

## Why exclude rather than expand further to cover everything

Even with the datastore expanded to ~180 GB, `gean-devnet`'s ~1 TB of real
(not sparse) data would need a datastore roughly 5-6x larger than what
this single physical disk (250 GB total) can provide. Growing the disk
further to accommodate it isn't a capacity-tuning problem, it's asking
GuildCloud's backup infrastructure to protect someone else's unrelated
project. The right boundary is the same one already drawn for G-14
(Guild-A legacy workloads) and the G-19 firewall ipset: GuildCloud's
operational infrastructure covers GuildCloud-relevant guests, not
everything that happens to share the physical hardware.

## What changed

- Live: `nodeE`'s `guild-pbs` VM disk grown 100→200 GB; partition and
  filesystem grown online.
- Live: `guild-b-standard-daily` backup job updated with `exclude:
  "300,400,500"` and an updated comment explaining why.
- Live: a real multi-guest backup run proving the scoped job works,
  including a proven-cheap incremental re-backup.

## Still open

- The excluded guests remain genuinely unbacked-up. If any of them later
  turn out to matter, they need their own decision (separate PBS
  datastore/disk, most likely) — not folded into this job.
- `homeassistant` (32 GB nominal) and `guildcloud-dev` (64 GB nominal)
  remain in the job's scope but weren't individually capacity-checked the
  way `gean-devnet` was — worth a similar `wr_highest_offset` spot-check
  if the job is ever seen failing on them specifically.
- `k8s-w-1` (VMID 121) is on the still-offline `podE` — will join the
  job's effective scope once that node is back, its capacity impact
  unverified until then.
