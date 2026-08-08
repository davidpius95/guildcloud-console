# Phase 1 — Operator Runbook

Project: Supabase "GuildCloud Control Plane", ref `ssbleuvjxlgttlkoancu`,
region `eu-west-1`. All procedures below assume access to either the
Supabase dashboard (`https://supabase.com/dashboard/project/ssbleuvjxlgttlkoancu`)
or the Supabase MCP tool connected to this project.

## Rotate the Supabase service-role key

**Not currently in use anywhere in this app** — no code path holds or needs
it (see `data-model.md`/`threat-model.md` for why the invite flow was
deliberately designed around not needing one). If a future phase introduces
a use for it (e.g. a real Admin-API-based invite flow), rotate it via:
Dashboard → Project Settings → API → reveal `service_role` key → "Roll API
key". Update wherever it's newly consumed (never commit it to the repo —
follow the same `.env.local`-only, gitignored pattern used for the
publishable key today). Rolling it invalidates the old key immediately;
confirm nothing was silently depending on the old value before rolling in
production.

## Run a new migration

1. Write the migration as a single, named, forward-only SQL file (this
   project used the `apply_migration` MCP tool directly against the live
   project — no local Supabase CLI/shadow-DB workflow was set up this
   session; if one gets added later, prefer it for anything schema-shaped).
2. Apply it. Immediately run `list_tables` to confirm the expected shape
   landed.
3. If the migration touches anything security-relevant (new table, new
   RLS policy, new `security definer` function, new grant/revoke), run
   `get_advisors(type: "security")` afterward and read every new finding —
   don't assume "it applied without error" means "it's safe." Two real
   findings were caught exactly this way in this project (see
   `threat-model.md` #3 and #4).
4. Regenerate `lib/supabase/types.ts` (`generate_typescript_types` MCP
   tool) and re-run `npm run typecheck` — a schema change with no type
   regeneration is a silent drift bug waiting to happen.

## Inspect `audit_log` for an incident

`audit_log` is append-only and has no service layer of its own — query it
directly:

```sql
select * from audit_log
where organization_id = '<org-id>'
order by created_at desc
limit 200;
```

Filter by `action` (`org.created`, `project.created`, `member.invited`,
`member.role_changed`, `member.removed`) or `actor_id` to narrow. Because
writes only happen through `log_audit_event` (itself gated by
`is_org_member`, see `threat-model.md` #3), every row here reflects an
action taken by someone who genuinely belonged to that org at the time —
there's no forged-entry scenario to rule out first.

`metadata` is a `jsonb` free-form field — its shape depends on the action
(e.g. `member.invited` stores `{email, role}`, `member.role_changed` stores
`{role}`). Check the relevant Server Action in `api-contract.md` for the
exact shape before assuming a key exists.

## Handle a stuck email-verification / OAuth-outage lockout

- **Email verification not arriving:** check Supabase Auth logs
  (`get_logs` MCP tool, or Dashboard → Logs → Auth) for delivery failures.
  Supabase's default email sending has real-world rate limits — if this
  becomes a recurring problem, the fix is configuring a custom SMTP
  provider in Auth settings, not something this session set up (Phase 1
  uses Supabase's default sender).
- **A user is stuck on `/verify-email` indefinitely:** confirm via SQL
  whether `auth.users.email_confirmed_at` is actually null for them — if
  it's set but the app still redirects to verify-email, the bug is in the
  session-refresh path (`middleware.ts`), not the verification itself.
- **Google/GitHub OAuth provider outage:** email/password sign-in
  (`signInWithEmail`) is a fully independent path — an OAuth provider
  outage doesn't lock out users who signed up with email, only those whose
  *only* auth method is that provider. There is no account-linking UI at
  Phase 1 to add a password to an OAuth-only account after the fact — that
  would be a real gap to close before this becomes a hard operational
  dependency on OAuth providers staying up.

## Add or remove a catalog row

```sql
-- add
insert into catalog_plans (id, name, vcpu, memory_gb, disk_gb, hourly_price, monthly_max, note, is_placeholder)
values ('std-16', 'Standard 16', 16, 32, 320, 0.32, 220, null, true);

-- remove (only if nothing references it yet - Phase 1 has no FK from
-- operations/resources into catalog_plans, so this is safe today; that
-- will change once Phase 2 adds real provisioning against these IDs)
delete from catalog_plans where id = 'std-16';
```

Leave `is_placeholder = true` until master plan §16's capacity → catalogue
work produces a real, measured price for that plan — see `data-model.md`'s
note on the known inconsistency between the seeded catalog and the real
Phase 0 Guild-A template catalogue before adding a new OS image row that
implies availability it doesn't actually have.

## General operating notes

- This project has no local dev/shadow-DB workflow set up — all schema
  changes go straight to the live project via `apply_migration`. Treat
  every migration as production from the moment it's applied.
- `npm run typecheck && npm run build` should be run after any change that
  touches `lib/supabase/types.ts`, `lib/types.ts`, or any Server Action —
  this catches type drift between the schema and the app before it ships,
  not after.
- Cross-org isolation is enforced entirely by RLS, not by any
  application-level filtering. If a future bug report describes "user A can
  see user B's data," the first thing to check is the RLS policy on the
  relevant table (`get_advisors` first, then read the policy SQL directly)
  — not the Server Action or query function, which have no filtering logic
  of their own to be wrong.
