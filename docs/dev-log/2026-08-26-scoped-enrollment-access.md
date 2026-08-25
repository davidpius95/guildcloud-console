# Dev log — 2026-08-26: enrollment is scoped to individual Guild instances

## Why this changed

The enrollment flow previously used one shared customer-device tag and added
a member-to-project network grant. A member who joined the tailnet could
therefore reach every instance in an applied project. That contradicted the
console's `access_grants` UI and the intended boundary: a customer device must
only reach the instance(s) it has been granted.

## New enforcement model

- A membership receives `tag:guildcloud-member-<membership-id8>`.
- A provisioned instance receives `tag:guildcloud-instance-<instance-id8>`.
- The designated tailnet-housekeeping worker reconciles both network grants
  and Tailscale SSH rules from database state.
- Owners/Admins receive only their own organization's instances. Other roles
  receive only an explicit instance grant, or all instances in a project when
  an explicit `all` grant exists.
- The reconciliation removes GuildCloud's former generic member-to-project
  grant and generic customer SSH rule. It preserves unrelated tailnet policy.
- Adding or revoking a console access grant marks the affected project pending
  so the UI can accurately say the next worker sync will apply it.

## Rollout order

Deploy the housekeeping worker first, verify that the live policy has no
generic customer-member route, then deploy `enroll-device`, and finally apply
the GitOps policy source. Existing enrollment URLs should be regenerated after
the enforcement rollout because any URL previously shared outside its intended
device owner is a bearer credential.

## Verification

- `npm --prefix deploy/site-worker test` — 99 tests passed, including scope,
  organization, legacy-grant removal, and Tailscale SSH-rule coverage.
- `npm run typecheck` — passed.
- `npm run build` — passed.

Live policy and device-tag verification must be recorded after the staged
production rollout; no raw enrollment URL or Tailscale key belongs in this
log.
