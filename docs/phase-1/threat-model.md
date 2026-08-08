# Phase 1 — Threat Model

Format matches `docs/decisions/`: each threat gets what it is, the
mitigation, and how to verify the mitigation actually holds — not just an
assertion.

## 1. Cross-org data leakage via a missing or wrong RLS policy

**Threat:** any read or write on `organizations`, `memberships`, `projects`,
`audit_log`, or `operations` that isn't correctly scoped to the caller's org
membership leaks or corrupts another tenant's data. This is the single most
important threat in a multi-tenant system built on RLS instead of a
service-layer authorization check.

**Mitigation:** every table has RLS enabled, with `select` scoped through
`is_org_member(organization_id)` and role-gated writes through
`has_org_role(organization_id, [...])`. No query path in `lib/supabase/
queries.ts` or any Server Action uses a service-role key or otherwise
bypasses RLS — there is no code path in this app that *can* bypass it,
because the service-role key was never obtained for this project (see
`data-model.md`). This is a structural mitigation, not a discipline one.

**Verification:**
- `get_advisors(type: "security")` run after schema completion — confirms every table has RLS enabled (Supabase's advisor flags any RLS-disabled public table directly).
- Manual cross-org proof (part of `docs/phase-1` end-to-end verification, tracked as task #11): create a second real test user + second org, confirm the UI shows zero rows from org 1, and a direct `execute_sql` query scoped to org 1's `organization_id` under org 2's session context returns zero rows.

## 2. Role self-escalation

**Threat:** a low-privilege member (Developer, Billing, Read-only) grants
themselves Owner/Admin, or removes the actual Owner to seize control.

**Mitigation:** the `memberships` update/delete RLS policies check
`has_org_role(organization_id, ['Owner','Admin'])` against the **actor's own**
membership row (resolved via `auth.uid()` inside the security-definer
function), not against any property of the row being modified. A Developer
attempting `updateMemberRole` on their own membership fails the RLS check
identically to attempting it on anyone else's — the policy has no
special-case for "editing yourself." The UI additionally hides the "Remove"
action for `role = 'Owner'` rows, which is UX only, not the actual gate.

**Verification:** `has_org_role`'s definition was read at write time to
confirm it queries `memberships where user_id = auth.uid()`, not a
parameter passed in from the client (which would be trivially spoofable).
Live test with a second, non-Owner test account is part of the pending
end-to-end verification pass.

## 3. `log_audit_event` RPC exposure — forged audit entries (found and fixed this session)

**Threat found via `get_advisors`:** `log_audit_event(p_organization_id, ...)`
was, as originally written, callable directly via RPC by *any* authenticated
user, with no check that the caller actually belongs to
`p_organization_id`. Any signed-in user could forge audit-log entries for
any organization, including ones they have no membership in — undermining
the entire point of an append-only audit log (a false trail is arguably
worse than no trail).

**Fix:** added `if not public.is_org_member(p_organization_id) then raise
exception 'not a member of this organization'; end if;` at the top of the
function body, applied via the `harden_audit_and_trigger_functions`
migration. This is defense-in-depth at the function level, not just a grant
change — even if `execute` were ever granted more broadly, the function
itself now refuses.

**Verification:** `get_advisors` re-run after the fix — no longer flags
uncontrolled write access via this function. (`log_audit_event` still shows
as RPC-callable in the advisor output, which is expected and safe: it's a
controlled write path with its own internal authorization check, not an
uncontrolled one.)

## 4. `handle_new_organization()` and helper functions — unintended RPC surface

**Threat:** `handle_new_organization()` is a trigger function that creates
the Owner membership row on org creation. If it were callable directly by a
client (not just by the trigger), a user could invoke it out of band with
an arbitrary `organization_id` and grant themselves Owner on an org they
don't belong to.

**Mitigation:** `execute` on `handle_new_organization()` revoked from
`public` — it can only run as the trigger fires, never as a direct RPC
call.

**Real gap caught during end-to-end verification, not at build time:** the
original hardening pass believed it had also revoked `anon` execute on
`is_org_member`/`has_org_role`, but a later migration (`create_rls_policies`,
which runs after function creation) recreates/re-grants against these
functions, and the `anon`-level revoke never actually held — confirmed via
`information_schema.routine_privileges`, which showed `PUBLIC` (and
therefore implicitly `anon`) still had `EXECUTE` on `is_org_member`,
`has_org_role`, and `log_audit_event`, and that `link_pending_invites`
(trigger-only, same class of function as `handle_new_organization`) had
never been locked down at all — grantable by `anon` *and* `authenticated`
via direct RPC. This was believed fixed and documented as fixed; it wasn't.
Found by re-running `get_advisors` as part of Phase 1 verification (not by
re-reading old migration SQL and assuming it worked) and cross-checked
directly against `information_schema.routine_privileges` before touching
anything.

**Actual fix, applied via `lock_down_function_grants` migration:** explicit
`revoke ... from public` and `revoke ... from anon` (not relying on the
default-grant-to-PUBLIC behavior alone) on `is_org_member`, `has_org_role`,
and `log_audit_event`, with `execute` re-granted to `authenticated` only.
`link_pending_invites` had `execute` revoked from `public`, `anon`, **and**
`authenticated` — nothing should call it directly, ever, only the
`auth.users` insert trigger.

**Verification:** `get_advisors` re-run after this fix — zero
`anon_security_definer_function_executable` findings remain for any of the
four functions. The three remaining `authenticated_security_definer_
function_executable` warnings (`is_org_member`, `has_org_role`,
`log_audit_event`) are expected and intentional — RLS policies and Server
Actions for signed-in users genuinely need to call these, and each has its
own internal authorization check (`is_org_member`) gating what it actually
does.

## 5. Pending-invite email-address impersonation (stated Phase 1 gap, not fixed)

**Threat:** `inviteMember` creates a pending `memberships` row keyed purely
by email address (`invited_email`). The `link_pending_invites` trigger
auto-links **any** newly created Auth user whose email matches, granting
them the invited role immediately, with no separate acceptance step, no
unique token, and no expiry. If an org Admin invites
`ex-employee@company.com` and that address is later reassigned or
re-registered by someone else at the same company (or, in principle,
anyone who can prove control of that mailbox through Supabase Auth's own
verification), they inherit the invited role automatically.

**Why this is accepted at Phase 1, not silently skipped:** building a
proper token-based invite-acceptance flow (unique link, expiry, explicit
accept) is real scope, and Supabase Auth's own email verification already
provides *some* assurance the invitee controls that mailbox at signup time
— this isn't wide open, just weaker than a dedicated invite-token system.
Explicitly flagged here and in `api-contract.md` as a stated simplification
against master plan §10's "customer-approved, time-limited" access
language (which is written about *support* access, not team invites, but
the same principle applies). **Should be hardened before this is treated as
production-ready for real customer teams** — this is the kind of gap this
project's "enterprise and production ready" bar means should get fixed, not
carried forever; noting it here rather than pretending it doesn't exist.

**Mitigation for now:** none beyond Supabase Auth's own email verification.
**Future fix:** replace the email-match trigger with a signed, expiring
invite token issued at invite time, checked explicitly at accept time.

## 6. Session and cookie handling

**Threat:** an incorrectly implemented `@supabase/ssr` integration can leak
sessions across users (shared cache), fail to refresh (silent logout /
stale session), or fail to invalidate on sign-out.

**Mitigation:** followed the standard `@supabase/ssr` App Router pattern —
separate browser client (`lib/supabase/client.ts`) and server client
(`lib/supabase/server.ts`, built per-request from `next/headers` cookies,
not shared/cached across requests), plus root `middleware.ts` that refreshes
the session on every request. `signOut()` calls `supabase.auth.signOut()`
server-side, which clears the session cookie.

**Verification:** not yet independently browser-tested this session
(pending task #11's end-to-end pass) — this should include confirming a
signed-out user genuinely cannot re-access `/console` via back-button/cache,
and that two concurrent browser sessions (two different users) never see
each other's cookies.

## 7. OAuth provider trust (Google, GitHub)

**Threat:** OAuth misconfiguration (wrong redirect URI allow-list, missing
`state` validation) enables account takeover via a crafted callback.

**Mitigation:** relies on Supabase Auth's built-in OAuth handling
end-to-end (`signInWithOAuth` → provider → `/callback` →
`exchangeCodeForSession`) — no custom OAuth state handling was written in
this app, deliberately, since Supabase Auth already implements this
correctly and reimplementing it would be the actual risk. Redirect URIs are
configured in the Supabase Auth provider settings, not hardcoded
client-side beyond `currentOrigin()/callback`.

**Verification:** not yet live-tested against real Google/GitHub OAuth apps
this session (would require registering real OAuth app credentials with
Google/GitHub, out of scope for this pass) — flagged as an open
verification item, not silently assumed working.

## 8. Placeholder pricing surfaced as real

**Threat:** `catalog_plans` rows could be mistaken for real, billable prices
if the `is_placeholder` flag is ignored by a future feature (e.g. a
checkout flow built against this table without checking the flag).

**Mitigation:** `is_placeholder boolean default true` is a column on the
data itself, not just a doc comment — any future code path that reads
`catalog_plans` can and should check it before treating a price as real.
Currently nothing in the app performs a real charge against these values at
all (billing is Phase 6).

**Verification:** schema-level (`list_tables` confirms the column and its
default exist); behavioral verification is deferred until Phase 6 actually
builds a checkout path that must be checked against this flag.

## 9. Audit log tamper

**Threat:** an org member with database-level intuition tries to edit or
delete an audit entry to cover their tracks.

**Mitigation:** no `update` or `delete` RLS policy exists on `audit_log` at
all — under RLS's default-deny model, the *absence* of a policy is itself
the denial, not a policy that says "deny." The only write path is the
`log_audit_event` function (itself now gated per finding #3 above).

**Verification:** pending task #11 includes a direct attempt to
`UPDATE`/`DELETE` an `audit_log` row as a normal authenticated org member
and confirming it's rejected by RLS, not just untested.

## 10. Silent-failure UX in `updateMemberRole`/`removeMember`

**Not a security threat, but adjacent and worth naming honestly:** both
actions currently swallow RLS-denial errors (`if (error) return;`) rather
than surfacing them to the UI. This means if RLS ever *correctly* denies an
action (e.g. a stale client tries a role change after being demoted
mid-session), the user sees nothing happen rather than a clear "not
authorized" message. Not a hole — the deny is real and effective — but a
real usability gap worth listing here since it was noticed while reasoning
about threat #2's mitigation, not worth a whole separate finding.
