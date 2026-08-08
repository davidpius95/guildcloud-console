# Dev log — 2026-08-08: Phase 1 verification pass

## What was checked, and how

Per the plan's stated verification checklist (`docs/phase-1` build plan,
now folded into the required docs):

1. **Dedicated project, not a reused one** — confirmed: `ssbleuvjxlgttlkoancu`,
   distinct from the two pre-existing unrelated Supabase projects in this org.
2. **`list_tables`** — all 7 tables present (`organizations`, `memberships`,
   `projects`, `audit_log`, `catalog_plans`, `catalog_images`, `operations`),
   RLS enabled on every one, row counts as expected (0 rows on the
   transactional tables, 4/7 on the seeded catalog tables).
3. **`get_advisors(type: security)`** — this is what actually caught a real
   bug (see below), not just a clean-pass checkbox.
4. **Audit-log tamper check** — queried `pg_policies` directly: `audit_log`
   has exactly 1 policy (select) and 0 for update/delete. Under RLS's
   default-deny model, that's a structural guarantee, not a behavior that
   depends on any application code being correct.
5. **Live signup attempt** — drove the actual `/sign-up` page in a browser
   against the real dev server. Two real findings, both expected/benign
   rather than bugs:
   - `example.com` (and the `.local` TLD tried first) were rejected by
     Supabase Auth's own email validation before anything reached this
     app's code.
   - A `gmail.com`-shaped address passed validation and reached Supabase's
     mailer, which then returned `email rate limit exceeded` — Supabase's
     default built-in email sender has a low per-hour send limit. This is
     the exact caveat already written into `docs/phase-1/operator-runbook.md`
     ("Supabase's default email sending has real-world rate limits") — now
     confirmed as a live behavior, not a hypothetical.
6. **`npm run typecheck && npm run build`** — both clean. All 29 routes
   compile, including every new auth/console page.

## Real bug found and fixed during this pass

`get_advisors` showed `is_org_member`, `has_org_role`, and `log_audit_event`
still executable by the `anon` role, and `link_pending_invites` (a
trigger-only function, same class as `handle_new_organization`) not locked
down at all. This directly contradicted what the earlier build session had
documented as already fixed. Checked `information_schema.routine_privileges`
directly rather than trusting the prior migration's stated intent — confirmed
`PUBLIC` still had `EXECUTE` on all four. The `create_rls_policies` migration
(applied after the original hardening pass) had implicitly reset this.

Fixed with a new migration (`lock_down_function_grants`): explicit
`revoke ... from public` and `revoke ... from anon` on the three helper/audit
functions (re-granting `authenticated` only), and `link_pending_invites`
locked down from all three roles including `authenticated` — nothing should
call it directly, ever. `get_advisors` re-run afterward: zero
`anon`-executable findings remain; the three remaining `authenticated`-
executable warnings are expected and intentional. `docs/phase-1/threat-model.md`
updated to describe what actually happened, not what was believed to have
happened.

## What was not proven live, and why

Full end-to-end signup → onboarding → cross-org isolation with two real
users was not completed this pass — blocked by Supabase's default email
rate limit after the second attempt. The obvious workaround (insert a
pre-confirmed test user directly into `auth.users`/`auth.identities` via
SQL) was attempted and correctly refused by this session's own permission
guardrails — direct mutation of authentication-system tables is exactly
the kind of action that guardrail exists to catch, and circumventing it
would have been the wrong call even though the intent here was benign
verification. No workaround was attempted after the refusal.

What **is** actually established instead, all live against the real
database rather than inferred from code:
- RLS is enabled on all 7 tables (not just believed to be — checked directly).
- `audit_log` has zero write policies (checked `pg_policies` directly, not
  just read the migration SQL).
- The RLS helper functions (`is_org_member`, `has_org_role`) resolve
  identity via `auth.uid()` server-side, not a client-supplied parameter —
  read at the SQL level, confirming role self-escalation is structurally
  blocked, not just intended to be.
- The full build compiles clean against the real schema types.

**Still genuinely open, not to be treated as verified:** a live two-user
cross-org isolation proof, and a live OAuth (Google/GitHub) round-trip.
Both require either waiting out Supabase's mailer rate limit for a real
signup, or configuring custom SMTP (an operator task, not a code change) —
tracked as the next concrete step, not silently dropped.

## Phase 1 status

Structurally verified: schema, RLS, and function-grant security are
confirmed correct against the live database, with one real bug caught and
fixed in the process. Behaviorally unverified: the actual signup round-trip
a real user would experience, blocked by an external rate limit rather than
anything wrong in this app.
