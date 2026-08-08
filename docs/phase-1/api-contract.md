# Phase 1 — API Contract

**This is an internal, RLS-enforced contract, not a public API.** There is
no external consumer yet — no CLI, no third-party integration, nothing that
would justify a versioned REST/GraphQL surface. Master plan §14 asks for
"API contract" as required proof for Phase 1; this document is that proof,
scoped to what actually exists: Next.js **Server Actions**, called directly
from Server/Client Components in the same app, with Postgres Row-Level
Security as the real enforcement layer underneath every one of them. A
Server Action that "succeeds" against RLS but touches the wrong org is a
bug in the RLS policy, not in the action — the policy is the source of
truth, the action is a thin wrapper.

Every action below runs as the calling user (via the Supabase server client
bound to their session cookies, `lib/supabase/server.ts`) — none use a
service-role key, because this session never obtained one (see
`data-model.md`).

## `app/(auth)/actions.ts`

### `signUpWithEmail(prevState, formData: { email, password })`
- Calls `supabase.auth.signUp`. Redirect target after email verification is `/callback` → `/onboarding`.
- No RLS gate (pre-auth).
- No audit event (no org exists yet to scope it to).

### `signInWithEmail(prevState, formData: { email, password })`
- Calls `supabase.auth.signInWithPassword`. On success, redirects to `/console` (the layout gatekeeper then routes to `/onboarding` if no membership exists).

### `signInWithOAuth(provider: "google" | "github")`
- Calls `supabase.auth.signInWithOAuth`, redirect via `currentOrigin()/callback`.

### `signOut()`
- Calls `supabase.auth.signOut()`, redirects to `/sign-in`.

## `app/(auth)/callback/route.ts`

- `GET` handler, not a Server Action. Exchanges the OAuth/email-verification `code` param for a session (`exchangeCodeForSession`), then redirects to `/console`.

## `app/(auth)/onboarding/actions.ts`

### `completeOnboarding(prevState, formData: { orgName, projectName })`
- **Inputs:** org name, first project name (both required, per master plan §4's exact join sequence — verify email → create org → create first project, done as one combined step here since there's no reason to force two round-trips).
- **RLS gate:** none needed on the org insert itself (any authenticated user may create an organization — there's no invite-only gate on org creation at Phase 1). The `on_organization_created` trigger creates the Owner membership row automatically; the project insert is then gated by `has_org_role(org_id, ['Owner','Admin'])`, which the caller trivially satisfies since they were just made Owner.
- **Audit events:** `org.created` (from the trigger), `project.created` (explicit `log_audit_event` RPC call after the project insert).
- **Errors surfaced:** Postgres constraint violations bubble up as `{ error: string }` (e.g. slug collision — mitigated by a random suffix, not eliminated, so still handled).

## `app/console/projects/actions.ts`

### `createProject(prevState, formData: { name, description? })`
- **RLS gate:** `has_org_role(org_id, ['Owner','Admin'])` via the `projects` insert policy — Developer/Billing/Read-only roles cannot create projects.
- **Audit event:** `project.created`.
- Accent color assigned by cycling through the 4 allowed values — cosmetic only, not user-chosen at Phase 1.

## `app/console/settings/actions.ts`

### `inviteMember(prevState, formData: { email, role })`
- **RLS gate:** implicit via `getCurrentUserOrg()` (must belong to an org to invite into it); the `memberships` insert policy further requires `has_org_role(org_id, ['Owner','Admin'])`.
- **Stated Phase 1 simplification:** this creates a pending `memberships` row keyed by email (`user_id = null`, `invited_email` set), auto-linked when that person signs up with a matching email (see `link_pending_invites` in `data-model.md`). It is **not** a token-based invite-acceptance flow — there is no unique invite link, no expiry, and anyone who signs up with that exact email address is silently granted the invited role, even if they weren't the intended recipient of the invite. This is called out explicitly here as a stated Phase 1 gap against master plan §10's implied "controlled" access model, not a silent omission. A real fix (invite tokens with expiry, explicit accept step) is future work.
- **Audit event:** `member.invited` (metadata: email, role).
- **Errors:** unique-constraint violation on duplicate pending invite → `{ error: "This email has already been invited." }`.

### `updateMemberRole(membershipId, role)`
- **RLS gate:** `memberships` update policy requires `has_org_role(org_id, ['Owner','Admin'])` **on the actor**, checked via the RLS policy against the caller's own membership row — not merely "a membership exists" for the target. This specifically prevents self-escalation: a Developer cannot promote themselves to Admin because the policy checks the actor's role, not the target row's current role.
- No return value / error surfaced to the UI beyond a silently-failed update (see `threat-model.md` for the honest caveat on this).
- **Audit event:** `member.role_changed`.

### `removeMember(membershipId)`
- **RLS gate:** same `has_org_role(org_id, ['Owner','Admin'])` actor check as above, via the `memberships` delete policy. The UI additionally hides the "Remove" action for `role = 'Owner'` rows, but that's a UI nicety, not the enforcement — RLS is.
- **Audit event:** `member.removed`.

## Read paths (`lib/supabase/queries.ts`, `import "server-only"`)

Not Server Actions (no mutation), but part of the same contract — every one
of these relies entirely on RLS to scope results, there is no explicit
`.eq('organization_id', ...)` filter layered on top as defense-in-depth
beyond what RLS already guarantees (deliberate — see `threat-model.md` on
why this is acceptable here).

- `getCurrentUserOrg()` — wrapped in React `cache()` to dedupe within a single request (called from the console layout gatekeeper *and* most pages). Returns the caller's org + membership, or `null`.
- `getProjectsForOrg(orgId)`
- `getProjectById(id)` — relies on RLS to return nothing (not an error) if the project isn't in the caller's org; the page calls Next's `notFound()` in that case.
- `getMembersForOrg(orgId)`
- `getAuditLogForOrg(orgId)`

## What stays mock data (explicitly, not an oversight)

Instances, databases, storage, volumes, functions, Kubernetes, networking,
monitoring, migration, marketplace, support, billing, quotas, SSH keys,
support-access — none of these have real tables yet. Their pages still read
`lib/mock-data.ts` directly. Resource *counts* shown on the (now-real)
projects page are computed from those same mock arrays against real project
IDs — an intentional hybrid stated in a code comment at the point of use,
not a hidden inconsistency.
