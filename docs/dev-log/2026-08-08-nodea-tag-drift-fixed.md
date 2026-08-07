# Dev log — 2026-08-08: nodeA Tailscale tag drift fixed

## What happened

Flagged in the previous session (during G-05 firewall work): nodeA's
Tailscale device had no `tag:guildcloud-mgmt` tag, while nodeB–E all did.
Re-checked live state first rather than trusting the earlier note — still
drifted a day later, confirming this isn't a transient blip.

## Fix

Device tags aren't part of the `policy.hujson` GitOps flow (that governs
ACL grants/tagOwners, not per-device tag assignment — the original
tagging was a one-time bootstrap API call per `infra/tailscale/README.md`).
Re-applied `tag:guildcloud-mgmt` to nodeA directly via the Tailscale device
API, then re-read the device's live tag state to confirm rather than
trusting the write call's response.

## Still open

Root cause unconfirmed — same open question as the earlier `podC` tag
reversion. Two devices doing this independently is worth a real
investigation if it happens a third time (check whatever runs on these
hosts that might call `tailscale up` without `--advertise-tags`, which
would silently strip tags on re-registration).

## What changed

- `docs/phase-0/gap-register.md` — G-01 entry updated: drift noted, then
  fixed and verified.
- Live change: nodeA Tailscale device re-tagged `tag:guildcloud-mgmt`.
