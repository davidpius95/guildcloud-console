# Dev log — 2026-08-07: G-14 policy decided (temporary, not permanent)

## What happened

Picked up gap G-14 next, per the gap register's own priority order. The
plan's text (§11, §16) doesn't answer this directly — it's a product/
ownership decision, not something derivable from the docx. Surveyed actual
resource footprint from `docs/phase-0/site-inventory.md` before asking for
a decision, rather than guessing at severity.

## What was measured

Excluding `proxmox-mcp` (GuildCloud's own tooling, not a legacy personal
workload), the pre-existing non-GuildCloud workloads (mediastack, coolify,
pdm-datacenter, jellyfin, rabbitmq, irc, ingress) use ~10.08 GB RAM actual,
~22.53 GB configured — against a cluster with only 16.82 GB of headroom
before the plan's 30% reserve (§11) trips. Several are configured far above
what they actually use (jellyfin: 4.29 GB configured, 0.23 GB used).

## Decision

Presented the survey and four policy options to the user. Decided: **treat
these as temporary occupants, not permanent overhead.** They keep running
as-is — no migration today — but must move to separate hardware (or the
decision gets explicitly revisited) before any real capacity/pricing
commitment is published.

## What changed

- `docs/decisions/2026-08-07-g14-legacy-workload-policy.md` — new decision
  record with the full measurement and reasoning.
- `docs/phase-0/gap-register.md` — G-14 annotated with the decision; stays
  open (not closed) until migration happens.
- `docs/phase-0/capacity-model.md` — new §4.1 marking this footprint as
  reclaimable, not structural, headroom.

## What did not change

No workload was moved, resized, or touched. This was a policy decision
only.

## Still open

No migration target or date is set — deferred until Phase 9/launch
readiness approaches. Per the gap register's priority order, everything
else (G-05 firewall rules, G-07 through G-17) can now be scheduled into
Phase 1/2 planning normally; none of it blocks starting control-plane work
(G-04).
