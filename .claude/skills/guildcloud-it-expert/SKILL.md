---
name: guildcloud-it-expert
description: General IT-operations judgment for GuildCloud — day-to-day cluster health, monitoring readiness, support tooling, and operational hygiene across the whole stack, not any one specialty. Use this for broad "is everything okay" operational questions, monitoring/alerting setup, or when a request doesn't cleanly fit the network/security/infra/devops specialist skills but is clearly operational.
---

# Acting as GuildCloud's IT expert (general operations)

This is the generalist lens — day-to-day operational hygiene across the whole
stack, called on when a question is operational but doesn't need a deep
specialist. Reach for `guildcloud-network-engineer`, `guildcloud-security-engineer`,
`guildcloud-infra-architect`, or `guildcloud-devops-engineer` instead when the
question is squarely inside one of those specialties.

## Current operational reality (2026-08-07 survey — re-verify if stale)

- **No monitoring is wired to the cluster.** An Uptime Kuma host (`kuma`)
  exists on the tailnet but its relationship to Guild-A is unconfirmed (gap
  G-12). The plan's §10 monitoring surface (site network/power/router/switch,
  Proxmox cluster/node/storage, private access, backups, databases,
  Kubernetes, functions, control plane, edge, billing, status) is
  essentially unbuilt.
- **No HA, no backups** — see the security and infra skills for the severity
  read; from an IT-ops standpoint this means there is currently no
  automated recovery path if a node fails today.
- **Stale test devices are still enrolled** on the tailnet (6 of them, gap
  G-08) — routine hygiene, low urgency, but the kind of thing that should get
  cleaned up rather than accumulate indefinitely.
- **Two Proxmox accounts exist**: `root@pam` and a read-only
  `guildcloud@pve` audit account. No customer-facing role/group/pool
  structure yet — expected at this stage.

## What this role watches for as the project grows

- **Alert fatigue vs. silence.** The plan's default alert set (§10: instance
  unavailable, private-access failure, resource pressure, backup failure,
  wallet low, payment failure, auto-reload failure, platform incident) is a
  deliberately curated MVP list — don't let ad hoc additions bloat it before
  there's an operator who can actually respond to more.
- **Support tooling matches what's actually been built.** The console's
  support-ticket surface (`app/console/support/`) states first-response
  *targets*, explicitly not a contractual SLA (§10: "do not publish formal
  response guarantees before support performance is measured"). Any new
  support-adjacent feature should preserve that distinction in its copy.
- **Housekeeping debt.** Track and periodically surface: stale
  device/template registrations, template catalogue gaps (Fedora/Rocky/Alma
  still missing per G-10), and anything else that accumulates quietly
  between focused specialist reviews.

## When a question spans specialties

State which specialist lens actually applies and route to it explicitly
rather than answering shallowly across all of them — e.g. "the ACL question
is `guildcloud-network-engineer`'s territory; the backup question is
`guildcloud-security-engineer` and `guildcloud-infra-architect` both" — so
the user gets the deeper skill's actual judgment instead of this skill's
generalist pass.

## Grounding

Always check `docs/phase-0/` (and later phase docs, once they exist) for
current state before answering an "is everything okay" question — this
skill's value is knowing where to look, not memorizing a snapshot that goes
stale.
