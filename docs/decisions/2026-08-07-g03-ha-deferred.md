# Decision: G-03 (no Proxmox HA configured) is deferred, not resolved

**Date:** 2026-08-07
**Status:** accepted — no infrastructure change made. Gap register severity
revised to reflect what the plan actually requires at MVP.

## Context

The gap register (`docs/phase-0/gap-register.md`) rated G-03 ("no HA
resources configured — a node failure does not restart or relocate any
guest") as **High** severity, citing "§8 recovery language; implicit in
'restore into a healthy site'" as the plan reference. That citation was
written from a paraphrase, not the plan's exact text.

Per this project's working discipline, re-read the plan's exact text before
architecting anything non-trivial. Doing so for §3, §8, and §10 changes the
picture.

## What the plan actually says

- **§3, Protection tiers — Standard:** *"Daily encrypted off-site backup;
  seven-day retention; restore into a healthy site."* This is a backup/restore
  recovery promise — it describes recovering a guest from a backup copy onto
  working infrastructure, not automatically relocating a running guest at the
  moment a node fails. That's G-02's territory (backups), already substantially
  addressed on-site; off-site remains blocked on G-13 (single site).
- **§3:** *"No untested SLA or active-active promise."* Rules out any implicit
  live-failover commitment at MVP.
- **§10, Support and incident operations:** *"MVP automation safely retries
  jobs and reconnects; operators handle real incidents. **Advanced automatic
  failover comes later.**"* This is explicit and direct: automatic failover
  (which is what Proxmox HA / `ha-manager` provides — automatic guest restart
  or relocation on node failure, no operator involved) is scoped **out** of
  MVP by the plan itself.

Read together, "restore into a healthy site" was never a citation for live
HA — it's the same promise as G-02, just phrased at the tier-marketing level
rather than the implementation level. There is no plan text anywhere that
requires `cluster/ha/resources` to be non-empty before MVP.

## Decision

Downgrade G-03 from **High** to **Low** in the gap register, and reclassify
it as a **post-MVP hardening item**, not a Phase 0 blocker. No infrastructure
change is made today.

This does **not** mean HA is a bad idea — it's cheap, and Proxmox supports it
natively. It means implementing it now would be scope-ahead-of-evidence: the
plan's own MVP principle (§1: "prove every customer promise with a repeatable
test before publishing it") only requires proving backup/restore, which G-02
already did with a real drill. Building HA now, before Phase 1's control
plane or Phase 3's tenancy model exist, adds live-system complexity
(capacity-aware HA groups, RAM reservation behavior on failover, a group
policy for nodeC's halved RAM and nodeE's non-Ceph role) with no plan
requirement pulling it forward, and no customer to validate it against.

## When to revisit

Automatic failover becomes a real requirement once the plan's own §10
language ("comes later") is actually reached — realistically alongside
Warm Standby tier work (G-13, blocked on a second site) or when Protected
tier's "priority restore handling" gets defined in Phase 4/6. At that point,
design HA with the same capacity-aware rigor as the PBS decision: nodeC's
RAM deficit and nodeE's non-OSD role both need explicit handling in any HA
group definition, not a blanket "all nodes, all guests" policy.

## What this changes

- `docs/phase-0/gap-register.md`: G-03 severity **High → Low**, plan
  reference corrected to cite §10's explicit deferral instead of an implicit
  reading of §8/§3.
- No live system was touched.
