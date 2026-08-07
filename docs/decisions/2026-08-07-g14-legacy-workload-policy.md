# Decision: G-14 — pre-existing personal workloads are temporary, not permanent

**Date:** 2026-08-07
**Status:** accepted — policy decision only. No workload was moved, resized,
or touched today.

## Context

Gap G-14 (`docs/phase-0/gap-register.md`): non-GuildCloud workloads
(mediastack, coolify, jellyfin, rabbitmq, irc, pdm-datacenter, ingress,
proxmox-mcp) occupy real capacity on Guild-A with no stated policy on
whether they stay, move, or count against customer capacity. §11 requires
"plans and quotas are derived from measured real capacity" — that can't be
honest while an unknown, unbounded amount of capacity is silently spoken
for by workloads with no relationship to GuildCloud.

The plan itself has no text answering this question directly — it's a
product/ownership decision, not something §11/§16 already resolves.

## What was measured (`docs/phase-0/site-inventory.md`, `capacity-model.md`)

Excluding `proxmox-mcp` (GuildCloud's own management tooling, not a legacy
personal workload):

| Workload | Actual RAM used | Configured max |
| --- | ---: | ---: |
| mediastack | 4.11 GB | 4.29 GB |
| coolify | 3.95 GB | 4.29 GB |
| pdm-datacenter | 1.49 GB | 4.29 GB |
| jellyfin | 0.23 GB | 4.29 GB |
| rabbitmq | 0.13 GB | 2.15 GB |
| irc | 0.09 GB | 2.15 GB |
| ingress | 0.08 GB | 1.07 GB |
| **Total** | **~10.08 GB** | **~22.53 GB** |

Against a cluster with only **16.82 GB** of headroom before the plan's own
30% reserve (§11) trips, these workloads' actual usage alone consumes over
half the remaining margin; their configured ceiling exceeds the entire
margin.

## Decision

Treat these workloads as **temporary occupants, not permanent overhead**.
They continue running as-is today — no forced migration, no resize, no
disruption — but the capacity model and any future customer-facing catalogue
must **not** treat their footprint as a permanent fixed cost baked into
sellable capacity. Instead:

1. `capacity-model.md` is updated to mark this ~10-22 GB as **reclaimable**,
   not structural, headroom.
2. Before Phase 9 (Launch readiness) or any real capacity/pricing commitment
   is published, these workloads move to separate hardware, or the decision
   gets revisited explicitly if moving them turns out to be impractical.
3. This is a standing TODO against the gap register, not a one-time note —
   G-14 stays open (re-scoped, not closed) until a migration happens or this
   decision is explicitly revised.

## Why not the other options

- **Permanent overhead**: rejected — would silently and permanently shrink
  sellable capacity on the cluster's binding constraint (RAM) without ever
  being revisited, which contradicts §11's "measured real capacity" standard
  once GuildCloud has actual customers depending on that number being real.
- **Right-size now, keep indefinitely**: right-sizing configured limits
  (jellyfin/rabbitmq/irc/ingress are configured far above actual use) is
  still worth doing independently as a cheap headroom win, but doesn't
  address the harder question of whether personal infrastructure and a
  commercial product should share hardware at all. Deferred as a possible
  near-term action, not the policy itself.

## What this changes

- `docs/phase-0/gap-register.md`: G-14 annotated with this decision — still
  open, now with a stated direction instead of no policy at all.
- `docs/phase-0/capacity-model.md`: §5 updated to note this footprint is
  reclaimable, not structural.
- No live infrastructure was touched.

## Still open

- No target date or destination hardware for the migration is set — that
  depends on when Phase 9/launch readiness actually approaches, which isn't
  scheduled yet.
- Whether `proxmox-mcp` itself eventually needs a dedicated ops node instead
  of sharing customer-capacity nodes is a related but separate question, not
  decided here.
