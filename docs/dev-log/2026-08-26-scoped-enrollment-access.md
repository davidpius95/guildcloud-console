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

## Production verification

- `npm --prefix deploy/site-worker test` — 99 tests passed, including scope,
  organization, legacy-grant removal, and Tailscale SSH-rule coverage.
- `npm run typecheck` — passed.
- `npm run build` — passed.
- The worker release was deployed on the Guild-A housekeeping host and a
  reconciliation cycle was run after the GitOps baseline applied.
- Sanitized live-policy verification: **0** generic customer network grants,
  **0** generic customer SSH rules, **8** membership-to-instance network
  grants, and **8** matching membership-to-instance SSH rules.
- The GitOps workflow for the policy baseline completed successfully.

The updated `enroll-device` source is committed, but its Supabase Edge
Function publish remains pending the project's Supabase CLI deployment
authorization. Until that publish is performed, do not generate a new device
enrollment command: the currently deployed function can still attempt to
reintroduce the retired generic tag. No raw enrollment URL or Tailscale key
belongs in this log.
