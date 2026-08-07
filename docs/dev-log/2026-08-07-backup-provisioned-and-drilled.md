# 2026-08-07 — Backups: PBS provisioned, scheduled, and restore-drilled (gap G-02)

## What changed

1. Re-read §8 and §3's protection-tier table verbatim from the docx before
   designing anything.
2. Wrote a Decision Record proposing the architecture, checked capacity
   (~16.8 GB RAM headroom cluster-wide, per Phase 0), and picked nodeE (no
   Ceph OSD role, most RAM free, empty local SSD) as the host — deliberately
   separate storage from `ceph-vm`, which every other guest's disk lives on.
3. **Asked for explicit sign-off before provisioning** — creating a VM is a
   real, not-trivially-reversible capacity commitment on a tight cluster.
4. Cloned VM 400 (`guild-pbs`) from the existing Debian 13 template onto
   nodeE, migrated its disk from shared `ceph-vm` to nodeE's local storage
   (cross-node clone to local storage isn't supported directly — cloned to
   shared storage first, then `vm_move_disk`), resized to 100 GB.
5. Installed `proxmox-backup-server`, created datastore `guild-a-standard`.
6. **Hit a real bug** registering it as Proxmox VE storage — full
   troubleshooting trail and root cause (PBS token privilege separation: a
   token's effective permission is the *intersection* of its own ACL and its
   owning user's ACL, not the token's alone) is in the Decision Record.
7. Scheduled a daily cluster-wide backup job, 7-day retention, matching the
   Standard tier exactly.
8. **Ran a real restore drill**, not a simulated one: backed up a real guest,
   restored it to a new VM, booted it, and confirmed via the guest agent
   that hostname and `/etc/machine-id` matched the original — proof this is
   the actual restored disk, not a fresh image. Deleted the drill VM after.
9. Updated `docs/phase-0/gap-register.md`: G-02 Critical → Medium (on-site
   backup proven; off-site blocked on G-13, not something this work could
   fix).

## Why

Direct instruction, carried from the Tailscale work: check the plan's exact
text before architecting anything, and don't claim a promise is met until
it's actually demonstrated. §8 is explicit that a backup isn't valid until a
restore drill proves it — so provisioning PBS and scheduling a job alone
would not have been enough to close this gap honestly.

## Verified

- `vzdump` task log: "Backup job finished successfully," 16 GiB transferred.
- `qmrestore` task: `exitstatus: OK`.
- Restored VM actually booted; guest agent confirmed hostname (`test-vm`)
  and `/etc/machine-id` (`994a8169d7e04a9382aa50c91720431c`) match the
  original — not inferred from the restore command's exit code alone.
- `cluster/backup` re-fetched after job creation, confirmed present with
  correct schedule/retention.
- Drill VM stopped and deleted afterward — confirmed via task exit status,
  not assumed.

## What's still open

- Off-site / two-location backup — blocked on gap G-13 (single site).
  Nothing to build here until a second site exists.
- Object storage export as a second, closer-term failure domain (§8's own
  fallback option) — a follow-up decision.
- Protected tier's longer retention / more frequent recovery points — this
  work only covers the Standard tier.
- Only one guest (a stopped test VM) has an actual proven restore. The daily
  job covers everyone going forward; worth drilling a running guest too when
  there's real reason to.
