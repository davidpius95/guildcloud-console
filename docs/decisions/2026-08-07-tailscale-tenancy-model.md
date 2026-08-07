# Decision: Tailscale tenancy model for Guild-A

**Date:** 2026-08-07
**Status:** accepted — applied to the live tailnet 2026-08-07, and moved under GitOps (see `infra/tailscale/`)

## Context

Master Plan §17 lists as its own planning action: *"Choose and document the
Tailscale tenancy and customer-identity model after validating commercial and
isolation constraints."* Table 17 (§15 in the doc's decision log) names this
explicitly as an open decision requiring "product/terms review and a
practical multi-tenant access test" before it's final.

The Phase 0 survey (`docs/phase-0/gap-register.md`, G-01) found the live
policy has no isolation at all: `grants: [{src:["*"], dst:["*"], ip:["*"]}]`
— every one of the 27 enrolled devices can reach every other device on every
port. This contradicts §6's zone table and the private-access promise
directly.

## Decision

Adopt a **tag-based, default-deny** tailnet policy, mapped directly onto the
four zones already defined in §6's table:

| Plan zone | Tag | Reachability rule |
| --- | --- | --- |
| Management | `tag:guildcloud-mgmt` | Never customer reachable — reachable only by `tag:operator` |
| Tenant | `tag:guildcloud-tenant-<project>` | Only members/devices of that specific project |
| Backup | `tag:guildcloud-backup` | Never customer reachable — reachable only by `tag:guildcloud-mgmt` |
| Future edge | *(not modeled yet — no edge nodes exist)* | — |

Plus one tag not in the plan's table but required to make the others work
without breaking operator access: `tag:operator` — David's own devices,
which can reach `tag:guildcloud-mgmt` for administration.

This satisfies §16's constraint directly: none of this is customer-visible —
a customer's device gets tagged into their project's tenant tag by the
control plane during enrollment (Phase 3 work); they never see or configure
a tailnet, route, or ACL rule themselves.

## Why tag-based over the current identity-based grants

The live policy grants by Tailscale *identity* (email address / autogroup),
which is how personal Tailscale setups are normally configured and is
reasonable for a single-owner tailnet. It doesn't scale to multi-project
customer isolation — there's no way to say "this project's devices only" with
identity grants when many projects may share the same GuildCloud owner
identity. Tags are the standard Tailscale primitive for exactly this pattern
and are what §16's "practical multi-tenant access test" should evaluate.

## Alternatives considered

- **Leave the ACL identity-based, add per-resource firewall rules instead**
  (Proxmox datacenter firewall, currently empty per gap G-05). Rejected as
  the *only* layer — it protects guest-to-guest traffic within Proxmox, but
  doesn't stop a compromised or misconfigured tailnet device from reaching
  another node directly over Tailscale, which is the actual mechanism the
  plan describes in §6.
- **Separate Tailscale tailnet per site** (already effectively true — only
  one site exists). Deferred until a second site is real (gap G-13); not a
  decision to make against a single-site cluster.

## Consequences

- Makes explicit, for the first time, which devices are GuildCloud
  infrastructure vs. personal/other — several are currently ambiguous (see
  below) and this decision cannot be safely applied until they're
  classified, because tagging something incorrectly into `tag:guildcloud-mgmt`
  under default-deny could cut off a service the classification got wrong.
- Requires manual tagging today (Tailscale API); becomes automatic once
  Phase 3 (device onboarding) exists in the real control plane.
- Does not yet address gap G-06 (standing root SSH grant to 7 external
  accounts) or G-07 (homeassistant's unapproved routes) — those are separate
  explicit decisions folded into the same policy change, listed below.

## Device classification (from the Phase 0 Tailscale survey)

| Device | Proposed tag | Confidence |
| --- | --- | --- |
| nodeA, nodeB, nodeC, nodeD, nodeE | `tag:guildcloud-mgmt` | High — confirmed Proxmox cluster nodes |
| `proxmox-mcp` | `tag:guildcloud-mgmt` | High — holds Proxmox API credentials |
| `GL-MT6000` (Flint 2 router) | `tag:guildcloud-mgmt` | High — the site's own gateway, per §6 physical site model |
| user's MacBook Pro ×2, David's S24 Ultra, `DESKTOP-PL7IN7F` | `tag:operator` | High — David's own devices |
| `homeassistant` | *(unchanged — no GuildCloud tag)* | High — personal service; already flagged (G-07) for its unapproved route advertisements, which stay unapproved |
| `podA`–`podE` | **unclassified** | **Low — do not know their purpose.** Naming suggests they could be Kubernetes worker pods (there's an empty but configured `k8s-rbd` Ceph pool) or something unrelated. Not tagging them into any zone until confirmed — leaving them on the current default rather than guessing. |
| `kuma` | **unclassified** | Medium — plausibly GuildCloud monitoring, plausibly personal. Confirm before tagging as `tag:guildcloud-mgmt`. |
| `fleetbase`, `gean-devnet`, `usher-node` | **unclassified** | Low — names don't match GuildCloud or Proxmox conventions. Likely personal/unrelated projects; confirm before excluding from all GuildCloud grants (which is the default outcome under this policy if left untagged — worth confirming that's fine). |
| `guildct-template`, `guildct-template-1`, `ct-clone-test`, `ts-autojoin-test`, `ts-autojoin-ct-test`, `agent-watch-test` | *(recommend removing)* | High — stale test/template registrations (gap G-08), last seen 2026-07-27–31. Removing from the tailnet is cleaner than tagging. |

## Folded-in decisions from the gap register

- **G-06 (standing root SSH to 7 external accounts on `tag:gean-devnet`):**
  this draft policy removes that grant by omission (the new `ssh` block only
  covers `tag:operator` → `tag:guildcloud-mgmt`). **Needs explicit
  confirmation** — if any of those 7 accounts should retain access, say so
  before this is applied, or they lose SSH the moment this policy goes live.
- **G-07 (homeassistant's advertised routes):** left unapproved, matching
  current live behavior. No change either way without a separate decision.

## What was actually applied (2026-08-07)

Resolved by the user before this was applied:

- **G-06 (external SSH grant):** kept exactly as-is, unchanged. Explicit
  decision — not a removal, not a scope-down.
- **`podB`, `podC`, `podD`, `podE`:** tagged `tag:guildcloud-mgmt`, alongside
  `nodeA`–`nodeE`. (`podD` inferred from a duplicated "podb" in the user's
  answer — flagged explicitly at the time; not corrected since.)
- **`podA`:** left untagged — not mentioned in the classification answer,
  and not assumed into scope.
- **`kuma`:** confirmed as GuildCloud monitoring, tagged `tag:guildcloud-mgmt`.
- **`fleetbase`, `gean-devnet`, `usher-node`, `homeassistant`:** left
  untagged (personal/unrelated, per the "recommended" default — no explicit
  answer overrode this for these specific hosts).

Scope actually applied, deliberately narrower than the original draft: the
pre-existing broad owner grants (`autogroup:member` → `*`) were **kept**,
not removed — see the "Pre-existing owner-level access, kept unchanged" note
in `infra/tailscale/policy.hujson`. Only the new `guildcloud-mgmt`/`operator`
scaffolding was added. Real enforcement (a device that *isn't* `davidpius95@`
or one of his tagged devices getting denied by default) doesn't exist yet,
because no such device exists yet — it activates automatically the first
time Phase 3 enrolls a real customer device as a `tag:guildcloud-tenant-*`
node rather than a full tailnet member.

## GitOps

This policy is now managed as code: `infra/tailscale/policy.hujson`,
applied via `.github/workflows/tailscale-acl.yml` (validate on PR, apply on
merge to `main`). The 2026-08-07 apply above was a one-time bootstrap done
directly via the API, before the workflow's GitHub secrets were configured —
see `infra/tailscale/README.md` for what setup is still needed and the
manual-apply fallback until then. Every future ACL change should be a PR
against that file, not a direct API call.

## Still open (unchanged from the original proposal)

- Tenant-zone grants (`tag:guildcloud-tenant-<project>`) — intentionally not
  created; no real tenant exists to scope them to yet. Add in the same PR
  that builds Phase 3 device enrollment.
- Backup-zone grants (`tag:guildcloud-backup`) — intentionally not created;
  no real backup target exists yet (gap G-02).
- `podA`, `fleetbase`, `gean-devnet`, `usher-node`, `homeassistant` remain
  unclassified/untagged. Revisit if their role becomes relevant.
