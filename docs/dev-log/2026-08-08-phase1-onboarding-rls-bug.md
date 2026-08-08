# Dev log — 2026-08-08: real onboarding bug found and fixed via live testing

## What happened

User set up custom SMTP (Resend) and enabled Google/GitHub OAuth in the
Supabase dashboard. We then drove the actual sign-up flow live: real email
sent, real verification link clicked (after one retry — two overlapping
sign-up calls had invalidated the first email's token, a real but benign
timing issue, not a bug), real sign-in, landed correctly on `/onboarding`.

Submitting the "create organization" form failed every time with:

```
new row violates row-level security policy for table "organizations"
```

This was not caught by any prior verification pass (schema checks, RLS
policy review, `get_advisors`, or the earlier database-level checks) —
none of those exercise the actual `INSERT ... RETURNING` code path that
Supabase's JS client generates for `.insert().select().single()`. It only
surfaced by actually driving the real UI.

## Root cause

`completeOnboarding` (`app/(auth)/onboarding/actions.ts`) does:

```ts
.from("organizations").insert({...}).select("id").single()
```

The `on_organization_created` trigger (`AFTER INSERT ON organizations`)
creates the caller's Owner `memberships` row within the same statement.
`organizations`' SELECT RLS policy requires `is_org_member(id)` to be
true. Postgres evaluates that SELECT-policy check against the row being
returned by `RETURNING` — but empirically, that check does **not** see
the trigger's own membership insert, even though a separate follow-up
statement in the same transaction does. Reproduced directly in SQL,
isolating the exact behavior:

- Plain `INSERT` (no `RETURNING`): succeeds.
- Same `INSERT ... RETURNING id`: fails with the RLS error.
- `INSERT` followed by a **separate** `SELECT` in the same transaction:
  succeeds, and shows the trigger's membership row correctly.

First hypothesis (the `is_org_member`/`has_org_role` helper functions
being marked `STABLE`, which by common assumption "shouldn't see" writes
from earlier in the same command) was tested and **fixed anyway** since
it was genuinely wrong to mark them `STABLE` — their result depends on a
table other statements/triggers write to within the same transaction, so
`STABLE`'s caching contract didn't actually hold. But changing them to
the default (volatile) did **not** resolve the RETURNING failure, proving
that wasn't the (sole) cause — the real issue is specifically about
`RETURNING`'s implicit SELECT-policy check timing relative to same-
statement `AFTER INSERT` triggers, a narrower and more specific Postgres/
RLS interaction than the volatility theory suggested.

## Fixes applied

1. **Database** (`fix_rls_helper_volatility` migration): `is_org_member`
   and `has_org_role` changed from `STABLE` to the default (volatile) —
   correct regardless of whether it was the root cause here, since their
   result can legitimately change within a transaction.
2. **Grants re-applied** (`reapply_grants_after_volatility_fix`
   migration): `CREATE OR REPLACE FUNCTION` resets a function's ACL to
   the default (`PUBLIC` gets `EXECUTE`), which silently undid the
   `anon`-lockdown from the earlier `lock_down_function_grants` migration
   (see `docs/phase-1/threat-model.md` §3–4). Caught by re-running
   `get_advisors` immediately after, not assumed safe.
3. **Application** (`app/(auth)/onboarding/actions.ts`): the organization
   `id` is now generated client-side (`crypto.randomUUID()`) and inserted
   explicitly, with no `.select()` chained onto that insert — avoiding
   `RETURNING` entirely for this specific insert, since nothing about the
   row's other columns is needed back (the generated id is already known).
   The project insert immediately after this is a **separate** statement
   sent to Supabase, by which point the org and its Owner membership are
   already committed and fully visible — the same pattern proven to work
   in the SQL reproduction above.

## Verification

- Direct SQL reproduction with `set local role authenticated; set local
  request.jwt.claims = ...` before and after each fix — confirmed the
  exact failure and, after the code fix (verified by testing the same
  no-`RETURNING` shape directly), that it clears.
- `get_advisors(type: "security")` re-run after the grant re-fix — clean
  except the expected `authenticated`-callable warnings and one unrelated
  pre-existing finding (leaked-password-protection disabled — not part of
  Phase 1 scope, noted for a future pass).
- **Live re-test end-to-end**: real browser session, real account
  (already-verified email), submitted the onboarding form — succeeded.
  Confirmed directly against the database: `organizations` row
  ("GuildCloud HQ"), `memberships` row (Owner, correct user), `projects`
  row ("Production"), and both `audit_log` entries (`org.created`,
  `project.created`) all present and correctly linked. Confirmed visually
  too: `/console/projects` renders the real "Production" project with
  zeroed real resource counts, not mock data.

## Why this matters

This is exactly why the plan called for live browser-driven verification,
not just schema/RLS static checks — `get_advisors` and direct policy
review both looked clean, and the bug was real anyway. It only showed up
by actually running the flow a real user would run. Task #12 (live
two-user cross-org isolation + OAuth proof) is still open, but the single
biggest unverified path from the earlier pass — real signup through real
onboarding — is now proven working, not just typechecked.
