# Dev log — 2026-08-08: PBS capacity for Guild-B sorted out

## What was asked

Follow-up from the earlier Guild-B wiring: the PBS host had only ~75GB
free while some Guild-B guests are much larger than anything on Guild-A.
Flagged then, asked to resolve now.

## What was found

Measured rather than assumed. `gean-devnet` (tagged `ethereum;gean;
lean-devnet`) has a 1TB disk allocated, and checking its actual QEMU block
stats (`wr_highest_offset`) showed ~991.5GB of that has genuinely been
written — real blockchain devnet data, not sparse space. No realistic
datastore sizing on this single 250GB physical disk could have
accommodated a full backup of this guest. Also identified two other large,
clearly non-GuildCloud guests by their tags: `cloudstack-aio` (79.5GB,
tag `cloudstack`) and `fleetbase` (150GB, tag `fleetbase;logistics`) —
separate side projects sharing the hardware, same category as Guild-A's
G-14 legacy workloads.

Separately, checked the physical disk backing the PBS VM: `nodeE`'s
`local-lvm` thin pool had 123.7GB genuinely available, real headroom to
grow into without affecting anything else on that node.

## What was done

1. Grew the PBS VM's disk 100GB → 200GB (`qm resize`), then grew the
   guest's partition (`growpart`) and ext4 filesystem (`resize2fs`)
   online — no downtime, no service interruption. Verified via `df`
   inside the guest and both clusters' own storage-status views
   independently (both now show 180.7GB avail / 211.2GB total).
2. Scoped the `guild-b-standard-daily` job to exclude the three
   oversized non-GuildCloud guests (VMIDs 300, 400, 500), with a comment
   explaining why.
3. Re-ran the job's actual parameters (all guests except the exclusions)
   against a real node, not just a single test guest. Confirmed two real,
   useful things: dirty-bitmap incremental backups are genuinely cheap
   (VM102's second backup: 120MiB transferred, 99% reused), and datastore
   usage grew gradually and predictably while the larger k8s-cp-1 guest's
   first-time full backup was in progress — no exhaustion, ~180GB
   available held steady throughout.

## What this doesn't cover

The excluded guests remain genuinely unprotected by backups — that's a
deliberate scope decision (GuildCloud's backup infrastructure protects
GuildCloud-relevant guests, not everything sharing the hardware), not an
oversight. If they matter later, they need their own storage decision.
`homeassistant` and `guildcloud-dev` stayed in scope but weren't
individually spot-checked the way `gean-devnet` was — worth doing if the
job is ever seen failing on them. `k8s-w-1` (on the still-offline `podE`)
is unverified until that node returns.

## What changed

- Live: `guild-pbs` VM disk grown 100→200GB, partition/filesystem grown
  online.
- Live: `guild-b-standard-daily` job scope updated (exclude 300,400,500).
- Live: real multi-guest backup run as final proof.
- `docs/decisions/2026-08-08-g18-pbs-capacity.md` — full decision record.
- `docs/phase-0/gap-register.md` — G-18 capacity risk resolved.
