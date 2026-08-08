# Phase 1 — Data Model

**Built:** 2026-08-08. Backing store: Supabase (Postgres 17.6.1.155), project
**"GuildCloud Control Plane"**, ref `ssbleuvjxlgttlkoancu`, region `eu-west-1`.
This is a dedicated project — not either pre-existing, unrelated Supabase
project in the same org (`Guild Audits website`, `GuildPay Ai`, both
`INACTIVE`).

Auth is Supabase Auth (`auth.users`, not modeled here) with Google, GitHub,
and email/password (+ verification) enabled, per master plan §4's join
sequence: sign up → verify email → create organization → create first
project.

## Tables

### `organizations`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid, pk | |
| `name` | text | |
| `slug` | text, unique | generated with a random suffix at creation (see `app/(auth)/onboarding/actions.ts`) to avoid collisions without a pre-signup availability check |
| `owner_id` | uuid → `auth.users` | |
| `wallet_balance_cents` | bigint, default 0 | **Phase 6 placeholder.** No wallet/billing logic reads or writes this yet |
| `created_at` | timestamptz | |

### `memberships`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid, pk | |
| `organization_id` | uuid → `organizations` | |
| `user_id` | uuid → `auth.users`, **nullable** | null while an invite is pending (see below) |
| `invited_email` | text, nullable | set for pending invites; cleared conceptually once linked (row keeps it for history, `user_id` becomes non-null) |
| `email` | text | denormalized copy of the member's email — clients cannot query `auth.users` directly, so this is the only way the UI can display who a membership belongs to |
| `role` | text, check ∈ `Owner, Admin, Developer, Billing, Read-only` | matches the existing `TeamMember.role` union already used by the mock UI |
| `device_enrolled` | boolean | |
| `invited_by` | uuid → `auth.users`, nullable | |
| `invited_at` | timestamptz, nullable | |
| `joined_at` | timestamptz, nullable | |
| `last_active_at` | timestamptz, nullable | |
| `created_at` | timestamptz | |

Constraints:
- `check (user_id is not null or invited_email is not null)` — a row must be either a real member or a pending invite, never neither.
- Unique `(organization_id, user_id)` where `user_id is not null`.
- Partial unique index on `(organization_id, invited_email)` where `invited_email is not null and user_id is null` — prevents double-inviting the same pending email.

**Why nullable `user_id`:** the Supabase MCP tool used to build this project
deliberately only exposes the publishable key, never the service-role key —
by design, not an oversight in this session. A conventional invite flow
(look up or pre-create the Auth user via the Admin API) needs the
service-role key. Instead, `inviteMember` creates a membership row with
`user_id = null` and `invited_email` set. A trigger on `auth.users` inserts
(`link_pending_invites()`) finds any pending membership matching the new
user's email and links it (`user_id` set, `email` copied from the new
user). No elevated credential required anywhere in the flow.

### `projects`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid, pk | |
| `organization_id` | uuid → `organizations` | |
| `name` | text | |
| `description` | text, default `''` | |
| `accent` | text, check ∈ `lemon, sky, violet, amber`, default `lemon` | matches the existing `Project` mock type exactly |
| `created_at` | timestamptz | |

### `audit_log`

Append-only. No `insert`/`update`/`delete` RLS policy exists for direct
client writes — the **only** way a row is created is the `log_audit_event`
security-definer function (see below). `update`/`delete` are simply denied
by the absence of a policy, not by an application-level check that could be
bypassed.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | bigint, identity, pk | |
| `organization_id` | uuid → `organizations` | |
| `actor_id` | uuid → `auth.users`, nullable | null for system-triggered events (e.g. org creation, which happens inside a trigger before the actor's own session context is meaningfully "them acting") |
| `project_id` | uuid → `projects`, nullable | |
| `action` | text | e.g. `org.created`, `project.created`, `member.invited`, `member.role_changed`, `member.removed` |
| `target_type` | text, nullable | |
| `target_id` | text, nullable | |
| `metadata` | jsonb, default `'{}'` | |
| `created_at` | timestamptz | |

### `catalog_plans`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text, pk | e.g. `std-1`, `std-2`, `std-4`, `std-8` |
| `name` | text | |
| `vcpu` | int | |
| `memory_gb` | numeric | |
| `disk_gb` | numeric | |
| `hourly_price` | numeric | |
| `monthly_max` | numeric | |
| `note` | text, nullable | |
| `is_placeholder` | boolean, default `true` | **the data itself carries the "not real pricing" flag.** Real pricing is blocked on master plan §16's capacity → catalogue step, not yet done. Seeded rows are copied from the pre-existing `lib/mock-data.ts` values, not derived from any real cost model |

### `catalog_images`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text, pk | |
| `name` | text | |
| `version` | text | |
| `family` | text, check ∈ `os, solution` | |
| `recommended` | boolean | |
| `available_sites` | text[] | |

**Known inconsistency, flagged not hidden:** the seeded catalog images
(Ubuntu 24.04, Fedora 41, etc. — copied verbatim from the existing mock
data) do not match the real Phase 0 template catalogue built on Guild-A
(Ubuntu 26.04, Fedora 43, Rocky 10.2, AlmaLinux 10.2 — see
`docs/decisions/2026-08-08-g10-template-catalogue.md`). This is acceptable
*because* `catalog_plans`/`catalog_images` are explicitly placeholder
(no real provisioning reads them yet — that's Phase 2). It becomes a real
bug only if Phase 2 wires provisioning to this table without first
reconciling the two lists.

### `operations`

Schema + simple state only, per the plan's explicit Phase 1 scope.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid, pk | |
| `organization_id` | uuid → `organizations` | |
| `project_id` | uuid → `projects`, nullable | |
| `state` | text, check ∈ `running, succeeded, failed` | |
| `stages` | jsonb | |
| `created_at` | timestamptz | |

**Explicitly deferred to Phase 2, documented in the migration file itself:**
idempotency keys, retry/backoff logic, and any actual worker execution.
There is nothing real for this table to orchestrate yet — no site worker
exists until Phase 2's Proxmox integration.

## Helper functions (RLS support, not app-facing)

- **`is_org_member(p_org_id uuid) returns boolean`** — `security definer`. True if `auth.uid()` has a membership row (with a non-null `user_id`) in that org.
- **`has_org_role(p_org_id uuid, p_roles text[]) returns boolean`** — `security definer`. True if the caller's membership role in that org is in the given list.

Originally marked `stable`; changed to the default (volatile) via the
`fix_rls_helper_volatility` migration — their result depends on the
`memberships` table, which other statements (including AFTER triggers)
can write to within the same transaction, so `stable`'s "same result for
the whole statement" contract didn't actually hold. See the
`RETURNING` + trigger caveat below.

Both are `security definer` specifically to break RLS self-recursion: a
`memberships` policy that queried `memberships` directly to check
membership would recurse infinitely. Granted `execute` to `authenticated`
only — `anon` cannot call either (see threat-model.md).

## Triggers

- **`on_organization_created`** → `handle_new_organization()`, `security definer`. On `organizations` insert: creates the Owner `memberships` row for `owner_id` (looking up their email for the denormalized `memberships.email` column) and calls `log_audit_event` for `org.created`. `execute` revoked from `public` — this must only ever run as a trigger, never be RPC-callable directly.
- **`link_pending_invites()`**, `security definer`, on `auth.users` insert: finds any `memberships` row with `user_id is null` and `invited_email` matching the new user's email, sets `user_id` and `email` on it.

**`RETURNING` + `AFTER INSERT` trigger caveat (found live, 2026-08-08):**
an `INSERT ... RETURNING` on `organizations` fails RLS even for a fully
legitimate insert, because the `RETURNING` clause's implicit SELECT-policy
check (`is_org_member(id)`) evaluates before `on_organization_created`'s
membership row is visible to it — even though a separate follow-up
statement in the same transaction sees that row fine. This is a same-
command evaluation-order quirk, not a policy bug (`with_check` on the
INSERT itself was independently verified to pass). **Any insert into a
table whose SELECT policy depends on a same-statement `AFTER INSERT`
trigger must avoid chaining `.select()` in the Supabase JS client** —
generate the row's `id` client-side and insert it explicitly instead (see
`completeOnboarding` in `api-contract.md`). Full repro and fix history in
`docs/dev-log/2026-08-08-phase1-onboarding-rls-bug.md`.

## Deferred to later phases (explicitly, not silently)

- Real service-catalog pricing (`catalog_plans.is_placeholder`) — blocked on master plan §16.
- Any resource tables (instances, volumes, databases, etc.) — Phase 2. The Phase 1 console UI computes resource *counts* per project from the existing mock arrays as an intentional hybrid (see `api-contract.md`).
- `operations` idempotency/retry/worker execution — Phase 2.
- `wallet_balance_cents` real billing logic — Phase 6.
- Full token-based invite acceptance (magic-link-style, not just email-match-on-signup) — noted as a Phase 1 simplification in `api-contract.md`, not a silent gap against master plan §10.

## Verification performed

- `list_tables` after every migration batch — all 7 tables present, RLS enabled on all 7, expected columns present.
- `get_advisors(type: "security")` — run after the schema was complete and again after two hardening fixes (see `threat-model.md`); zero unexpected findings remain.
- Catalog seed confirmed: 4 `catalog_plans` rows, 7 `catalog_images` rows, matching the values previously hardcoded in `lib/mock-data.ts`.
