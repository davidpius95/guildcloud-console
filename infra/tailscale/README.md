# Tailscale ACL — GitOps

`policy.hujson` in this directory is the **single source of truth** for the
Guild-A tailnet's access policy. Do not edit the policy in the Tailscale
admin console — edit this file, open a PR, and let the workflow apply it.

## How it works

`.github/workflows/tailscale-acl.yml`:

- **Pull request touching `policy.hujson`** → validates the policy against
  the live Tailscale API (`action: test`). No changes are applied. Review
  the PR diff like any other infra change.
- **Push to `main` touching `policy.hujson`** → applies the policy to the
  live tailnet (`action: apply`).

This is Tailscale's own documented GitOps pattern
(`tailscale/gitops-acl-action`), not a custom script — standard, supported,
and matches how any other infra-as-code change in this repo should flow:
propose in a PR, review the diff, merge, and the live state follows.

## One-time setup (not yet done — required before the workflow can run)

An OAuth client with policy-file (ACL) read+write scope, added as two GitHub
repo secrets:

1. Create an OAuth client at
   <https://login.tailscale.com/admin/settings/oauth> with the **Policy
   File** scope (read + write).
2. In this repo's GitHub settings → Secrets and variables → Actions, add:
   - `TS_OAUTH_CLIENT_ID`
   - `TS_OAUTH_CLIENT_SECRET`

This step needs a repo admin with access to both the Tailscale admin console
and GitHub secret settings — it isn't something that can be done through the
API survey/edit tools used elsewhere in this project.

## Until the workflow is wired up: manual apply

The policy in this file was **bootstrapped directly** on 2026-08-07 (applied
once via the Tailscale API, before this GitOps workflow existed, to close
gap G-01 without waiting on GitHub secret setup). From that point forward,
**any further change should go through a PR against this file**, not a
direct API call — that's the entire point of putting it under GitOps. If the
workflow isn't wired up yet when a change is needed, apply the file's exact
content manually and note in the PR description that it was applied outside
the workflow, so the drift is visible rather than silent.

## Why the policy is shaped the way it is

See `docs/decisions/2026-08-07-tailscale-tenancy-model.md` — the reasoning
for the tag structure, what was deliberately left unchanged, and what's
still open (tenant-zone and backup-zone grants, both intentionally absent
until real tenants/backups exist).
