# GuildCloud project skills

Skills scoped to this repository, loaded automatically by Claude Code (and
readable directly by anyone/anything else working in this directory,
including Codex — they're plain markdown).

## Workflow skills

| Skill | When to use |
| --- | --- |
| `guildcloud-context-handoff` | Before continuing work in Codex, a fresh session, or after a long break |
| `guildcloud-verify-green` | After every code change, before marking any task done |
| `guildcloud-docs` | After every feature/fix/decision — dev log, decision records, phase evidence |
| `guildcloud-standards` | Writing or reviewing any code in this repo |

## Expert-role skills

| Skill | Lens |
| --- | --- |
| `guildcloud-senior-engineer` | Code review — architecture fit, correctness, simplicity |
| `guildcloud-network-engineer` | Tailscale ACL, VLANs, SDN, firewall, site connectivity |
| `guildcloud-product-designer` | New flows, UX comparisons, plan-fidelity |
| `guildcloud-infra-architect` | Control-plane design, capacity/catalogue, phase sequencing |
| `guildcloud-security-engineer` | Access control, secrets, credential-handling UI |
| `guildcloud-devops-engineer` | Git workflow, repo sync, commit discipline, deploy |
| `guildcloud-it-expert` | General operational hygiene, monitoring, routing to the right specialist |

## How these relate to each other

`guildcloud-standards` and `guildcloud-verify-green` apply to nearly
everything — read those first. The seven role skills are lenses to switch
into for a specific kind of judgment call; `guildcloud-it-expert` explicitly
routes to the others rather than duplicating them. All of them defer to the
master plan docx as the actual source of truth — no skill here restates the
plan's requirements in full, they point to the relevant section instead, so
the plan stays the single place that can drift out of date.

Every skill assumes today's real state (as of the 2026-08-07 Phase 0 survey)
was true when it was written — re-check `docs/phase-0/` and later phase docs
rather than trusting a skill's "current state" section indefinitely.
