# 2026-08-07 — Tailscale ACL GitOps: verified end-to-end (with a real bug caught along the way)

## What changed

1. User set `TS_OAUTH_CLIENT_ID` / `TS_OAUTH_CLIENT_SECRET` as GitHub repo
   secrets (confirmed via `gh secret list` — names only, values never
   handled directly).
2. Opened a real PR (#1) with a comment-only change to `policy.hujson`, to
   exercise the workflow rather than assume it worked.
3. **First run failed**: `tailscale/gitops-acl-action@v3` doesn't exist.
   Checked the action's actual tags via `gh api repos/tailscale/gitops-acl-action/tags`
   — current major is `v1`. Also checked the action's real `action.yml` and
   found the input names were wrong too (`oauth-client-id`/`oauth-secret`,
   not `api-key`/`api-secret`) and `tailnet: "-"` needed to be the real
   tailnet name (`tail345216.ts.net`).
4. Fixed the workflow, pushed, re-ran — `test` passed on the PR.
5. Merged the PR to exercise `apply` on push to `main` — passed.
6. Re-fetched the live ACL after merge and confirmed it matches
   `policy.hujson` exactly, including comments (the GitOps action pushes
   raw HuJSON; the earlier direct-API bootstrap had stripped comments,
   since that path takes structured JSON).
7. Fast-forwarded local `main`, deleted the merged branch, confirmed local
   and remote are in sync (`git log --oneline` matches, no ahead/behind).

## Why

Wiring up GitOps isn't done until it's been watched to actually run — an
unverified workflow is a false sense of safety, arguably worse than no
workflow, since the next person to change the policy would trust it
silently. This also directly matches this project's own `guildcloud-verify-green`
skill: don't infer success from a write succeeding, re-read state after
changing it.

## Verified

- `gh secret list` confirmed both secrets present (names only).
- PR #1's `test` job: pass, both before-fix (failed correctly) and after-fix
  (passed correctly) — confirms the workflow actually exercises real
  validation, not a no-op.
- Push-to-main `apply` job: pass.
- Live ACL re-fetched post-merge and diffed against the committed file —
  identical.
- Local git state re-synced and confirmed clean.

## What's still open

- Same as the prior Tailscale entry: tenant-zone and backup-zone grants
  don't exist yet (nothing to scope them to), and `podA`/`fleetbase`/
  `gean-devnet`/`usher-node`/`homeassistant` remain unclassified.
- Nothing else newly opened by this entry — this was verification work, not
  new scope.
