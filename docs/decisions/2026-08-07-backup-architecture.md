# Decision: Backup architecture for Guild-A (gap G-02)

**Date:** 2026-08-07
**Status:** proposed — design only, nothing provisioned yet. Pending sign-off
on the resource commitment before creating any VM.

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
- The mechanism for daily, retained, encrypted backups.

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
- **A proven restore.** §8: *"A backup is not considered valid until a
  restore drill proves it can be used."* Standing up PBS and scheduling jobs
  is not the same as a validated recovery path — a real restore drill
  against a real guest must happen and be documented before the Standard
  tier's promise is honest, and before this decision's status can move from
  "backups exist" to "backups work."

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

## What's needed before this can move from proposed to applied

1. **Sign-off on the resource commitment** — creating a VM on a
   capacity-constrained cluster (~16.8 GB RAM headroom cluster-wide per
   `docs/phase-0/capacity-model.md`) is a real, not-trivially-reversible
   allocation. This decision does not provision anything until confirmed.
2. Once confirmed: create the VM, install PBS, configure the datastore,
   attach it as a backup target in Proxmox, schedule daily jobs, tag it
   `tag:guildcloud-mgmt`, and **run one real restore drill** — all logged in
   a follow-up dev log entry with actual command output, not just "should
   work."
