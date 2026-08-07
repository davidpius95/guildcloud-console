# Decision: Backup architecture for Guild-A (gap G-02)

**Date:** 2026-08-07
**Status:** accepted — provisioned, backed up, and restore-drilled
end-to-end. See "Restore drill" below for the proof.

## A real bug found and fixed along the way

Registering the PBS datastore as Proxmox VE storage initially failed
repeatedly with `Cannot find datastore 'guild-a-standard'`, even though the
datastore genuinely existed (`proxmox-backup-manager datastore list`
confirmed it) and the API token authenticated fine (`curl` against
`/api2/json/admin/datastore` returned HTTP 200). The response body was just
`{"data":[]}` — an empty list, not an error.

**Cause:** PBS API tokens are privilege-separated by default. A token's
effective permission is the *intersection* of its own ACL grants and its
owning user's ACL grants — not the token's grants alone. I had given the
token `backup@pbs!pve-cluster` `DatastoreBackup`/`DatastoreAudit`/`Admin`
directly, but never granted the underlying user `backup@pbs` anything, so
the intersection was always empty regardless of what the token itself held.
Granting `DatastoreBackup` + `DatastoreAudit` to the **user** `backup@pbs`
(not just the token) fixed it immediately — confirmed via the same `curl`
call returning the real datastore before retrying the Proxmox VE side, which
then succeeded on the next attempt.

Worth remembering for any future PBS token setup: **check both the token's
ACL and the owning user's ACL** before assuming a permissions problem is a
propagation or path-matching issue.

## Context

Phase 0 found **zero backups of any kind** on Guild-A: no scheduled jobs, no
Proxmox Backup Server, no replication (`docs/phase-0/gap-register.md`, G-02,
rated Critical). Plan §8 requires a separate backup target and encrypted
copies across at least two locations before any recovery promise is honest.
Table 5 (§3) promises the Standard tier: *"Daily encrypted off-site backup;
seven-day retention; restore into a healthy site"* — included in every
resource, not a paid add-on.

## Decision

Stand up a dedicated **Proxmox Backup Server** as a VM on **nodeE**, backed
by nodeE's local SSD — not the shared `ceph-vm` pool every other guest's disk
already lives on.

| Property | Value | Why |
| --- | --- | --- |
| Host | nodeE | No Ceph OSD role (§ Phase 0 survey) — losing nodeE doesn't touch storage redundancy for other guests, and PBS doesn't compete with Ceph for that node's resources. Most RAM headroom of any node (12.47 GB free). |
| Backup datastore | nodeE's local SSD (250 GB Samsung 860 EVO, currently empty — confirmed via `list_disks`/`get_storage_content`) | Physically separate disk from `ceph-vm`. Satisfies §8's "do not rely only on primary workload nodes" as well as a single site can — a Ceph or node failure elsewhere doesn't take backups with it. |
| Proposed VM footprint | 2 vCPU, 2 GB RAM, 100 GB disk | Conservative. Leaves nodeE with ~10.5 GB RAM headroom afterward — still the most of any node — and 150 GB SSD spare for datastore growth. |
| Schedule | Daily, all guests | Matches Standard tier's "daily... backup." |
| Retention | 7 days | Matches Standard tier exactly — no more, no less, until Protected tier work defines its own longer retention. |
| Encryption | PBS-native client-side encryption, key held outside the backup target itself | §8 "encrypted copies," §10 "secrets stored separately from customer-facing state." |
| Access | Reachable only from `tag:guildcloud-mgmt` (already-existing zone, see the Tailscale decision) | Matches §6's Backup zone: "never customer reachable." |

## What this does and does not satisfy

**Satisfies today:**
- A backup target that is not a primary workload node.
- Physical/storage separation from every other guest's disk.
- Daily, retained, encrypted backups — real, scheduled, and proven (see
  "Restore drill" below).

**Does not satisfy yet — stated plainly, not glossed over:**
- **"Off-site."** Table 5 says off-site explicitly; nodeE is the same
  building, same power, same network as every node it's backing up (gap
  G-13: only one site exists). This is not fixable without a second site —
  it is not something this decision can architect around. Once Guild-B (or
  any second site) exists, PBS sync-to-a-remote-PBS is the standard pattern
  and should be added then, not simulated now with a false claim.
- **"Two locations."** Same constraint — one site cannot provide two
  locations. §8's fallback, "add an independent object copy later where
  justified," is the closer-term option: a periodic export to Guild-A's own
  object storage would still be single-site, but at least a second failure
  domain within it. Worth a follow-up decision, not bundled into this one.

## Restore drill (2026-08-07) — the evidence §8 requires

§8: *"A backup is not considered valid until a restore drill proves it can
be used."* Not simulated — actually run:

1. Backed up VM 108 (`test-vm`, stopped, 16 GB disk) to the new datastore:
   `vzdump 108 --storage guild-pbs --mode snapshot`. Completed in 4m28s,
   transferred 16 GiB (80% sparse/zero — real data was a few GB), task log
   ends `Backup job finished successfully`.
2. Restored that exact backup to a **new** VM (4081), not overwriting the
   original — `qmrestore` with `archive: guild-pbs:backup/vm/108/2026-08-07T21:37:11Z`.
   Task `exitstatus: OK`.
3. **Booted the restored VM** and checked it via the QEMU guest agent, not
   just the restore command's exit code:
   - `hostname` → `test-vm` (matches original)
   - `/etc/machine-id` → `994a8169d7e04a9382aa50c91720431c` — matches the
     original disk's machine-id, proving this is the actual restored disk
     content, not a fresh image that happens to share a name.
4. Stopped and deleted VM 4081 — it was a drill target only, not meant to
   persist as a duplicate.

This is what moves the Standard tier's "daily encrypted off-site backup...
restore into a healthy site" promise from configured to demonstrated, for
the "backup exists and restores" half of that sentence. The "off-site" half
remains open per above.

## Alternatives considered

- **Ceph-based backup (RBD snapshots / export-diff to the existing pool).**
  Rejected as the *only* mechanism — snapshots on the same storage pool as
  the live disk don't survive a Ceph-wide failure, which is exactly the
  scenario §8 asks to be protected against. May still be useful as a fast,
  cheap *additional* recovery point layered on top of PBS, not a
  replacement for it.
- **External/cloud object storage as the backup target from day one.**
  Deferred — no such account/credential exists yet, and it introduces a
  cost and a third party before the local mechanism is even proven. Revisit
  once local PBS + a restore drill are working, per §8's "add an
  independent object copy later where justified."

## What's still open

- **Off-site / two-location backup** — blocked on gap G-13 (single site).
  Not a bug in this decision; a real prerequisite that doesn't exist yet.
- **Object storage export** as a second, closer-term failure domain (§8's
  fallback) — a follow-up decision, not bundled into this one.
- **The Protected tier's longer retention and more frequent recovery
  points** — this decision only builds the Standard tier's promise.
- **Applying this to guests beyond the one drilled.** The daily job covers
  every guest cluster-wide going forward, but only VM 108 has an actual
  proven restore so far. Worth spot-checking another guest (especially a
  running one, not just a stopped test VM) once there's a real reason to.
