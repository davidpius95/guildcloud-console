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

## Setup — done, 2026-08-07

`TS_OAUTH_CLIENT_ID` and `TS_OAUTH_CLIENT_SECRET` are set as GitHub repo
secrets (OAuth client scoped to Policy File read+write). The workflow was
verified end-to-end via PR #1: `test` passed on the pull request, `apply`
passed on merge to `main`, and the live ACL was re-read afterward and
confirmed to match the committed file exactly, comments included.

The action is `tailscale/gitops-acl-action@v1` (not `v3` — that tag doesn't
exist) with inputs `oauth-client-id` / `oauth-secret` (not `api-key` /
`api-secret`) and `tailnet: tail345216.ts.net` (not a placeholder) — the
first version of this workflow had all three wrong and failed on its first
run; fixed and reverified before merging.

**Going forward, every ACL change is a PR against `policy.hujson`.** No
direct API calls, no editing in the Tailscale admin console — both bypass
git history and will be silently overwritten by the next PR-driven apply.

## History

The policy was bootstrapped once via a direct API call on 2026-08-07, before
this workflow existed, to close gap G-01 without waiting on secret setup.
Every change since has gone through a PR.

## Why the policy is shaped the way it is

See `docs/decisions/2026-08-07-tailscale-tenancy-model.md` — the reasoning
for the tag structure, what was deliberately left unchanged, and what's
still open (tenant-zone and backup-zone grants, both intentionally absent
until real tenants/backups exist).
