# Dev log — Phase 2: real per-instance access grants, verified

## The fix

The "Access policy" card on the networking page already had the right
shape — member × project × resource type × resource — but was pure
client-local React state (`useState`), fed by mock `accessPolicyRules`/
`team` arrays. Nothing persisted; a page refresh silently discarded any
grant.

New `access_grants` table (RLS mirrors `ssh_keys`'s exact pattern: select
for org members, insert/delete for Owner/Admin only), new
`addAccessGrant`/`removeAccessGrant` Server Actions
(`app/console/networking/actions.ts`), and `access-policy-card.tsx` now
reads real `Membership[]` and real instances instead of mock
`TeamMember[]`/fictional resource ids, using the same
`useTransition`/`revalidatePath` pattern already proven in
`team-access-card.tsx`.

Only `instance` is a real resource kind today — `database`/`cluster`/
`bucket`/`function` stay mock (those subsystems are mock everywhere else
in this app too), but the grant record itself is real for all of them;
picking a *specific* database/cluster/etc. just isn't possible yet since
there's nothing real to pick from.

## Deliberate scope decision

This grant table is an authorization *record* only in this pass — it does
not yet scope SSH key access (Phase 1's org-wide push stays org-wide).
`ssh_keys` are org-wide, not per-person; scoping SSH by grant would mean
personal-per-member keys, a materially different feature. The natural
real enforcement target for this table is network reachability (which
tenant tags a member's own enrolled device can reach) — that only becomes
meaningful once Phase 3 (device self-enrollment) exists. Flagged as a
deliberate follow-up, not built this pass.

## Verified live, both directions, through the real UI

- As the real Owner, opened "Add rule", picked a real pending Developer
  member, the real "Production" project, resource type "Guild Instance",
  and the specific real `podTesting` instance.
- Confirmed via direct SQL: a real row landed in `access_grants` with the
  correct `project_id`/`membership_id`/`resource_id` (not placeholder or
  mismatched values).
- Confirmed the console UI reflected the new grant immediately after
  `revalidatePath` — this app has hit real stale-cache-after-mutation
  bugs before, so this wasn't assumed.
- Clicked "Revoke" in the real UI → confirmed via SQL the row was
  actually deleted (`count(*) = 0`) → confirmed the UI reflects the empty
  state again ("No explicit grants yet").

## Not run live this pass

A real second-session negative-access test (a non-Owner/Admin session
attempting a direct insert) wasn't exercised live — the RLS policy text
was reviewed via `pg_policy` introspection instead
(`has_org_role(organization_id, ARRAY['Owner','Admin'])` on both insert
and delete, matching `ssh_keys` exactly). Worth a real live check before
this is considered fully hardened, same gap noted for Phase 1.
