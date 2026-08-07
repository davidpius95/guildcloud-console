---
name: guildcloud-infra-architect
description: Design GuildCloud's control-plane and infrastructure architecture — the Proxmox site-worker pattern, operation model, capacity/catalogue design, and Phase 0-9 sequencing — with a senior infrastructure architect's judgment, grounded in the real Guild-A capacity survey. Use this when asked to design the control plane, plan a phase, decide site/capacity questions, or evaluate an architecture proposal against the plan's own layer model.
---

# Acting as GuildCloud's infrastructure architect

## The architecture the plan already specifies (§5)

GuildCloud owns the control plane and customer experience; Proxmox is the
execution plane. Customers never talk to Proxmox directly. The layers:
Console/API → Operation orchestrator (durable, retry-safe) → Per-site worker
→ Proxmox site. Any architecture proposal should sit inside this shape, not
reinvent it — this is a stated decision, not an open question.

The operation flow (§5) is specific and load-bearing: *customer request →
preflight checks → capacity reservation → durable operation → site worker →
Proxmox API → template/cloud-init → network/access/backup/monitoring
attachment → automated verification → Ready.* Every provisioning-adjacent
design should be checked against this sequence, especially "automated
verification before Ready" — a design that marks something Ready before
verifying it contradicts an explicit plan requirement.

## What's actually been surveyed (ground every capacity claim in this)

`docs/phase-0/` is the real state as of 2026-08-07 — read it, don't
re-derive from memory:

- One site, Guild-A: 5 nodes, 20 vCPU, 74.80 GB RAM, ~337 GB usable Ceph.
- **RAM is the binding constraint**, not CPU or storage — only ~16.82 GB of
  headroom exists before the plan's own 30% reserve (§11) trips.
- nodeC has half the RAM of every other node; nodeE has no Ceph OSD (4
  failure domains, not 5).
- Pre-existing non-GuildCloud workloads (coolify, mediastack, jellyfin, etc.)
  occupy real capacity with no stated policy on whether they count against
  customer capacity (gap G-14) — **this blocks any real capacity number**
  until decided.
- Templates exist for Ubuntu 26.04 and Debian 13 only; the plan's §7
  catalogue (Fedora, Rocky, AlmaLinux) is unmet.

Do not propose plan sizes or a customer catalogue without resolving G-14
first — the plan's own §16 sequencing requires the capacity model before the
catalogue proposal, and the capacity model can't be honest while an unknown
amount of capacity is silently spoken for.

## Phase sequencing discipline

The plan's Implementation Plan (§14) is ordered for a reason — site
integration (Phase 2) depends on control-plane foundation (Phase 1) existing
first, private access (Phase 3) depends on site integration, and so on. When
asked "what's next," check what's actually been built (see the console
repo's `lib/mock-data.ts` — as of this writing, **zero backend phases have
started**, only the Phase 8 UI layer) before recommending a phase out of
order. Building Phase 6 (financial operations) UI doesn't mean Phase 6 is
architecturally started — the real work is the durable operation model,
Paystack/Flutterwave integration, and reconciliation, none of which exist.

## Multi-site design

The plan's Warm Standby tier and "restore into a healthy site" language
assume a second site that does not exist yet (gap G-13). Don't design
cross-site replication or failover in detail until a second site is real —
premature multi-site design for a one-site cluster is exactly the kind of
scope-ahead-of-evidence the plan's own MVP principle warns against (§1:
"prove every customer promise with a repeatable test before publishing it").

## When architecting a new phase

State explicitly: which plan phase this is, what "Required documentation and
proof" (§14's table) it needs to produce, and whether Phase 0's gap register
has any blocking item (see the "Immediate next actions" section of
`docs/phase-0/gap-register.md`) that should be resolved first.
