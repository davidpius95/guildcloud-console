# Dev log — Phase 3: real device self-enrollment

## The fix

`memberships.device_enrolled` existed since Phase 1 with zero real
readers or writers. The "Enrolled devices" table was 100% mock (fictional
names, a different type from real `Membership`). There was no way for a
customer's own device to join the private network at all.

## Architecture

- **New Edge Function `enroll-device`** (`verify_jwt: true` — unlike the
  cron-triggered `site-worker-guild-a`, this is invoked directly by an
  authenticated console user, so it identifies the real caller via their
  session, not a static credential).
- Mints a real Tailscale key: `reusable: false`, **`ephemeral: false`**
  (unlike instance keys — a customer's laptop going offline overnight
  must not deregister it), tagged `tag:guildcloud-member`, 300s key
  expiry (the resulting device stays enrolled indefinitely; only the
  *unused* key expires fast).
- Ensures `tag:guildcloud-member` can reach every `applied` project's
  tenant tag in the org — same GitOps-exception precedent as
  `applyPendingProjectAcls`.
- The real key never reaches the console UI directly. It's stashed
  behind a one-time random token (`redeem_enrollment_token`, a narrow
  SECURITY DEFINER RPC — the Next.js app deliberately never holds a
  service-role key, so this is how the public, session-less
  `app/api/enroll/[token]` route can redeem it safely). The route
  returns the actual install script; the word "Tailscale" never appears
  in the console UI itself.
- **Completion signal is worker-driven, not client-trusted**: the new
  `syncMemberDeviceEnrollment` lists the real tailnet, matches by
  hostname (`member-<id8>`) + tag, and only then flips
  `device_enrolled`/`tailscale_device_id` — never a browser-side "I ran
  the command" ping.
- `removeMember` now calls `enroll-device`'s new revoke path (Owner/Admin
  only, verified server-side) to deauthorize the member's Tailscale
  device before deleting the row — closing the gap where the UI already
  promised "network permission and server login revoked together" but
  nothing enforced the network half.

## Real bug found and fixed during verification

The worker's self-deploy pipeline had been **silently broken for ~3
days**: `git remote` for the deploy repo got rewritten from the SSH URL
to an HTTPS URL at some point (cause unclear — possibly another tool's
git config normalization), so every `git fetch` failed with `fatal:
could not read Username for 'https://github.com'`, `set -e` exited the
script immediately, and nothing after it ran. No alerting caught
this — only a manual `journalctl` check during this verification did.
Fixed two ways: manually reset the remote on the live LXC to unblock
immediately, and made `deploy-pull.sh` re-assert the SSH remote URL on
every single run going forward, so this class of drift can't silently
break deploys again. This is a real, still-open observability gap worth
flagging: there's no alerting on deploy failures at all yet.

## Verified live

- Clicked "Connect this device" as the real signed-in Owner → got back a
  real, working `curl | sh` command pointing at a real one-time token.
- Redeemed the token directly → got back a real script containing a real
  Tailscale auth key (`tskey-auth-...`) and the correct hostname
  (`member-c3f57b80`, matching the real membership id).
- Confirmed single-use: a second redemption of the same token would fail
  (the RPC clears `enrollment_token` and deletes the Vault secret on
  first successful redemption — verified by code review of
  `redeem_enrollment_token`, matching `reveal_instance_ssh_password`'s
  already-proven reveal-once pattern).
- Confirmed the Edge Function's `ensureMemberGrants` step completed
  without error on both real calls (a failure there would have surfaced
  as an error in the returned command instead of a valid script).

## Explicitly not run live this pass

- **The final `tailscale up` execution** — the returned command points at
  `localhost:3100`, only reachable from this dev sandbox itself (a real
  deployed console would use a real public domain instead). Running it
  here would join this ephemeral agent sandbox to the real tailnet as a
  **persistent** (non-ephemeral) device with no guaranteed way to clean
  it up afterward (device deletion has repeatedly hit an admin-risk-level
  wall this session). The underlying `tailscale up --authkey ... --hostname
  ...` command pattern is already proven reliable elsewhere in this
  codebase (instance enrollment uses the identical pattern successfully,
  many times, this session) — the residual risk is low, but this exact
  script wasn't run end-to-end live.
- **`removeMember`'s revoke path with a real enrolled device** — no
  member has a real `tailscale_device_id` yet to revoke against (only the
  Owner successfully got as far as the token/script; running the actual
  `tailscale up` step, which would create a real device to revoke, was
  the deliberately-skipped step above). Code reviewed against the
  already-proven `processPendingInstanceDeletions` pattern instead.
