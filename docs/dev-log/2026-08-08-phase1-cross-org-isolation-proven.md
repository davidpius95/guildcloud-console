# Dev log — 2026-08-08: cross-org isolation proven with two real users

## What was tested

The last open item from Phase 1 verification (task #12): prove that one
real organization's data is genuinely invisible to a different real user,
not just "should be" per the RLS policy text.

## Setup

- **User 1**: `davidpius95@gmail.com`, org "GuildCloud HQ", project
  "Production", role Owner.
- **User 2**: `davidpius95+crossorgtest3@gmail.com` (a distinct Supabase
  Auth user — Gmail delivers the alias to the same inbox, but Supabase
  treats it as a fully separate account with its own uuid), org "Second
  Test Org", project "Sandbox", role Owner.

Getting user 2 signed up at all required fixing a real, separate issue
first: Resend's sandbox mode originally only delivered to the account
owner's exact verified address, blocking even the alias. The user
verified a domain in Resend and updated Supabase's SMTP sender address to
use it — after that, the alias signup delivered correctly and confirmed
normally.

## Proof, three independent ways

1. **UI**: signed in as user 2, `/console/projects` shows only "Sandbox"
   — no reference to "Production" or "GuildCloud HQ" anywhere.
2. **Unfiltered query under user 2's real session context**: `select id,
   name from organizations` (no `WHERE` clause at all) returns exactly
   one row — user 2's own org. RLS silently scopes the result set; it
   isn't the app adding a filter.
3. **Targeted lookups by known ID** (the strongest test — user 2 knows
   user 1's exact `organization_id`, `project_id`, and queries
   `memberships` for that org directly): all three return **zero rows**.
   Reproduced via `set local role authenticated; set local
   request.jwt.claims = '{"sub":"<user 2's real uuid>", ...}'` directly
   in SQL, matching the exact session context PostgREST would construct
   from a real request.

## Why this matters

This is the one proof point the Phase 1 plan called "non-negotiable" —
static RLS policy review and `get_advisors` both looked clean earlier in
this project, and still a real bug slipped through (the `RETURNING`/
trigger timing issue, see `2026-08-08-phase1-onboarding-rls-bug.md`).
Cross-org isolation needed the same standard: not "the policy reads
correctly," but "a second real account, with a second real session,
cannot read a first account's data even when it knows exactly what to
ask for."

## Phase 1 status

All items from the original verification plan are now closed:
schema/RLS/grants (live-checked), typecheck/build (clean), real signup →
verify → sign-in → onboarding (proven, after fixing the RETURNING bug),
Google + GitHub OAuth (both proven via real identity links and a real
login event), and now cross-org isolation (proven three ways above).
Phase 1's control-plane foundation is genuinely working, not just
documented as working.
