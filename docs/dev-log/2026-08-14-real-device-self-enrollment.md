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

## Follow-up: the actual `tailscale up` step, run live

A later verification pass closed the one gap above — the enrollment
script was run end-to-end on a real machine, not just reviewed.

**No disposable scratch VM existed.** Every existing instance
(`timing-e2e-demo`, `uther`, `podTesting`) is a live Production-project
tenant already running its own `tailscaled` identity — running the
member-enrollment script on one would have re-authenticated that
machine's existing tailnet connection under a different identity,
likely breaking its current private hostname. Provisioned a real,
throwaway `enroll-test-scratch` instance (Standard 1, Lagos 1) through
the actual console UI instead, purely as the enrollment target, and
deleted it afterward.

**Real bug found in an unrelated stage, while waiting for the scratch VM
to boot**: the new instance's own `network_access_attach` stage (which
installs *its own* tenant-identity Tailscale, unrelated to member
enrollment) failed after 8 retries: `guest exec pid 1057 did not finish
within 180000ms`. Direct inspection via guest-agent exec showed this
wasn't a hang — `apt-get dist-upgrade` had pulled in a `systemd` package
upgrade, which triggered a `dracut` initramfs rebuild, which genuinely
took longer than the 180s timeout tuned in this session's earlier
commits. The operation gave up permanently (`operations.state = failed`)
rather than retrying once dpkg/apt were done. This is a real, still-open
gap: the timeout covers package *download* but not a triggered
initramfs rebuild, and failed operations don't get automatically
retried. Not fixed this pass (out of scope for enrollment
verification) — worth a follow-up.

**Real gotcha confirmed**: the enrollment key's 300-second expiry
(`expirySeconds: 300` on the Tailscale key, by design — see
Architecture above) is real and was hit live. The token redeemed early
(while still waiting on the scratch VM) expired before the script ran;
`tailscale up` failed with `backend error: invalid key`. Re-clicking
"Connect this device" and running the fresh command immediately worked.
This confirms the reveal-once/short-key-lifetime design is doing its
job, not a bug — but it's a real operational trap for anyone testing
this flow with a slow-to-boot target.

**Verified live, independently, end to end:**
- Ran the real script (base64-piped onto the VM via guest-agent exec,
  since the returned command points at `localhost:3100` — only this dev
  sandbox can reach that, confirming the concern flagged in the original
  pass; a real deployed console would use a real public domain instead).
- `tailscale status --json` on the VM itself showed a real device:
  `HostName: "member-c3f57b80"`, `Tags: ["tag:guildcloud-member"]`
  (not `tag:guildcloud-tenant`), `Online: true`, a real Tailscale IP.
- One worker cycle later, `memberships.device_enrolled` flipped to
  `true` and `tailscale_device_id` matched the real device's NodeID —
  confirmed via SQL, not just trusting the UI.
- The real Settings/Networking UI showed "Enrolled" after refresh.
- The real ACL grant was confirmed via a direct Tailscale API call
  (worker's own OAuth-token-exchange pattern, reused standalone since
  the `mcp__tailscale__*` tools were broken this session by an
  unrelated schema-validation bug): `tag:guildcloud-member` really does
  grant to `tag:guildcloud-tenant-project-b44c4107`, the org's real
  applied Production project.

**Cleanup**: the test Tailscale device was deleted via a direct API call
(`DELETE device/<id>`, real `200`) — no admin-risk wall this time. The
scratch instance was deleted through the real console UI; confirmed gone
from both the `instances` table and Proxmox itself
(`qemu-server/708869.conf` no longer exists).

## Still not run live

- **`removeMember`'s revoke path with a real enrolled device** — the
  scratch instance and its device were deleted directly, not through
  `removeMember`'s own revoke-then-delete flow (no membership actually
  had a real `tailscale_device_id` at teardown time in a state that
  exercised that exact code path). Code reviewed against the
  already-proven `processPendingInstanceDeletions` pattern instead.
