# Decision: remove the tailnet wildcard grants, and reconcile ACL drift

**Date:** 2026-08-22
**Status:** proposed — drafted as `infra/tailscale/policy.proposed.hujson`, **not applied**. Applying is a deliberate, separate step (see "How to apply" below).

## Context

While testing the device-enrollment path end to end (the question was simply
"can a user who needs to enrol their device actually reach their VM"), three
things turned up that are worth recording, because two of them contradict
promises the product makes on screen.

### 1. The wildcard grants were never removed

`docs/decisions/2026-08-07-tailscale-tenancy-model.md` adopted a tag-based,
default-deny model to close gap **G-01**, which was recorded as: *"every one
of the 27 enrolled devices can reach every other device on every port."* The
tag scaffolding was added — but the wildcard grants were kept alongside it,
with an explicit and honest rationale in `policy.hujson`:

> This is what currently lets davidpius95@'s own devices reach
> personal/non-GuildCloud services [...] Removing it today would break those
> services for no real security benefit, since this tailnet currently has
> only one real identity — GuildCloud has no customer devices enrolled yet
> (Phase 3 doesn't exist).

That reasoning was sound when written. **It has since expired.** Phase 3
shipped: real device self-enrolment exists, devices enrol as
`tag:guildcloud-member`, and the console lists real members as Enrolled. So
G-01 is not actually closed — the live policy still opens with:

```json
{ "src": ["*", "autogroup:member"],
  "dst": ["*", "autogroup:admin", "autogroup:member"],
  "ip":  ["*", "tcp:*", "ipv4:*"] }
```

That rule sits above every tag rule and allows everything to everything.
Concretely, an enrolled customer device can reach `tag:guildcloud-mgmt` —
podA–podF, nodeA–nodeE, guild-pbs, both site workers, and the GL-MT6000
router — and the live SSH rules let `autogroup:member` SSH into that same
management zone as `root`. The Networking page states "Management — never
customer reachable" (Master Plan §6). Today that is not true.

### 2. `policy.hujson` has drifted from the live tailnet

The live policy carries tags and grants the committed file has never had:
`tag:guildcloud-member` (written by the `enroll-device` Edge Function),
`tag:guildcloud-pool` (warm pool), and three
`tag:guildcloud-tenant-project-<slug>` tags plus their grants (written by
`applyPendingProjectAcls` in `deploy/site-worker/index.js`).

Both are documented, accepted GitOps exceptions — per-tag grants can't wait
on a human merging a PR. The problem is the consequence, which was not
previously recorded: **the GitOps workflow applies `policy.hujson` wholesale
on merge to `main`.** Any PR touching that file today would delete every
dynamic tag and grant, orphaning every instance's tag and cutting off every
enrolled device. The README's "periodic sync-back job (not yet built)" is
the missing piece that would have prevented this.

### 3. `access_grants` enforces nothing

The Access policy card writes `access_grants` rows
(`app/console/networking/actions.ts`), and `lib/supabase/queries.ts` reads
them back for display. Nothing else consumes the table — not the Edge
Function, not the worker, not the ACL. Network reachability comes solely
from the `tag:guildcloud-member` → project-tag grant applied at enrolment,
which `enroll-device` adds for *every* project in the org because
memberships are org-wide.

So the UI copy — "Developer, Billing, and Read-only members cannot reach any
private resource until you add one" and "Removing a grant here takes effect
immediately for future connections" — describes enforcement that does not
exist in either direction.

## Decision

Adopt `infra/tailscale/policy.proposed.hujson`, which:

1. **Removes both wildcard grants**, replacing them with:
   - `autogroup:admin → *` — admins keep unrestricted reach, so fleet
     operations and the owner's personal services are unaffected. Tagged
     devices are not `autogroup:admin`, so no customer device or instance
     matches this.
   - `autogroup:member → autogroup:self` — every other user reaches only
     their own devices.
   - `group:gean-devnet-users → tag:gean-devnet` — **required**, not
     cosmetic. Those seven identities reached `tag:gean-devnet` *only*
     through the wildcards; the existing SSH rule alone would not have kept
     them working, because an SSH connection still needs a network grant.
2. **Drops `tag:guildcloud-mgmt` from tenant `dst`.** Management → tenant
   remains, deliberately one-directional.
3. **Tightens SSH**: `autogroup:member` removed from management SSH;
   customer SSH into instances is non-root only (instances use the `guildvm`
   cloud-init user, so root buys nothing).
4. **Folds the live dynamic tags and grants back in**, so applying it is
   non-destructive.

Companion change, made in the same work: `applyPendingProjectAcls` in
`deploy/site-worker/index.js` now writes `dst: [tag]` instead of
`dst: [tag, "tag:guildcloud-mgmt"]`. Without it, item 2 regresses one
project at a time — existing projects are safe (the function only checks
whether a grant with that `src` exists), but every newly created project
would reintroduce tenant→management reachability.

## What this deliberately does not fix

`access_grants` still enforces nothing. Making it real requires a
per-project membership concept, which is a schema change, not an ACL change.
Until then the honest options are to build that, or to change the console
copy to describe what the system actually does. **Finding 3 above is not
closed by this decision** — it is recorded so it is not mistaken for closed.

## Risks and what remains unverified

- The policy was **not** validated against the live tailnet. The only write
  path available was a real apply, and there is no dry-run. Grant semantics
  here are reasoned from the current live policy and device list, not proven.
- `autogroup:admin` must actually cover every identity that operates the
  fleet. Any operator who is a plain tailnet member rather than an admin
  will lose reach and needs an explicit group instead.
- Comments do not survive. `enroll-device` and `applyPendingProjectAcls`
  both GET the policy as JSON, mutate, and POST it back, stripping every
  comment. The file stays the readable source of truth; the live copy will
  not be.

## How to apply

Rename `policy.proposed.hujson` over `policy.hujson` and open a PR. The
workflow's `test` job validates against the live API before merge; `apply`
runs on merge to `main`. Do not apply by direct API call — that is what
produced the drift in item 2.

## References

- `infra/tailscale/policy.proposed.hujson` — the draft
- `docs/decisions/2026-08-07-tailscale-tenancy-model.md` — the model this
  extends, and the rationale that has now expired
- `docs/phase-0/gap-register.md` — G-01, which this reopens
- Master Plan §6 (zone table), §16 (tenancy model)
