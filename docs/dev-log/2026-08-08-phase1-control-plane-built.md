# Dev log — 2026-08-08: Phase 1 control plane built

## What was asked

Start Phase 1 (control plane foundation) for real, after confirming Phase 0
is genuinely verified (see `2026-08-08-phase0-final-verification.md`).
Master plan §14 scopes Phase 1 as: organizations, projects, roles,
authentication, audit, catalog, operation model — with required proof of
an API contract, data model, threat model, and operator runbook.

## Architecture decisions confirmed with the user before building

- **Database + auth: Supabase** (Postgres + Auth, Google/GitHub/email,
  Row-Level Security) — chosen over rolling custom auth.
- **Deployment target: Vercel**, eventually — no Vercel MCP connected this
  session, so actual deployment stays a manual step for later, not part of
  this pass.

## What was built

- A new, dedicated Supabase project ("GuildCloud Control Plane", ref
  `ssbleuvjxlgttlkoancu`) — explicitly not reusing either pre-existing,
  unrelated Supabase project in the same org.
- 7 tables with RLS on all of them: `organizations`, `memberships`,
  `projects`, `audit_log` (append-only via a security-definer function,
  no direct write policy at all), `catalog_plans`/`catalog_images`
  (seeded, explicitly flagged placeholder), `operations` (schema only,
  execution deferred to Phase 2).
- Full auth flow: sign-up/sign-in (email + Google/GitHub), email
  verification, onboarding (create org + first project in one step,
  matching master plan §4's exact sequence), session refresh middleware.
- Console pages converted from mock to real data: projects list, new
  project detail page, settings (org info + team/roles), new audit log
  page — while every other console page (instances, storage, billing,
  etc.) deliberately stays on mock data, since no backend exists for those
  yet and converting them would be scope creep against Phase 1's actual
  boundary.
- Landing page CTAs wired to the new real routes (`/sign-in`, `/sign-up`)
  instead of pointing straight at `/console` with no auth behind it.

## Real security findings caught during the build, not after

Two issues found via Supabase's `get_advisors` tool, not by eyeballing SQL:

1. `log_audit_event` was callable by any authenticated user for any org's
   ID with no membership check — could forge audit entries for orgs you
   don't belong to. Fixed by adding an internal `is_org_member` check
   inside the function.
2. The org-creation trigger function was executable directly via RPC
   (not just as a trigger), and the RLS helper functions were callable by
   `anon`. Both tightened — trigger-only functions revoked from `public`,
   helpers revoked from `anon`, kept for `authenticated`.

Full detail in `docs/phase-1/threat-model.md`, including one gap left
deliberately open rather than silently fixed: pending team invites are
matched purely by email address with no expiring token, which is real but
bounded risk, called out explicitly as a stated Phase 1 simplification.

## What changed

- New Supabase project + 13 migrations (schema, RLS, helper functions,
  triggers, seed data, two hardening fixes).
- `lib/supabase/{client,server,types,queries}.ts`, root `middleware.ts`.
- `app/(auth)/*` route group (sign-in, sign-up, verify-email, onboarding,
  callback).
- `app/console/layout.tsx` — now the real auth/org gatekeeper (previously
  had zero auth logic).
- `app/console/projects/*`, `app/console/settings/*` — converted to real
  data; `components/team-access-card.tsx` rewritten against real Server
  Actions.
- `docs/phase-1/{data-model,api-contract,threat-model,operator-runbook}.md`
  — the four required-proof documents.
- `npm run typecheck` clean throughout, re-verified after the landing-page
  CTA change.

## What's still open

- End-to-end browser verification (real signup → onboarding → cross-org
  isolation proof with a second test user → confirm `audit_log` rejects
  direct UPDATE/DELETE → `npm run build`) — not yet run, tracked as the
  next task.
- OAuth providers (Google/GitHub) were wired to Supabase Auth's standard
  flow but not live-tested against real registered OAuth apps this
  session.
- The email-based pending-invite gap noted above.
- Everything Phase 2+ scoped: real resource tables, operation execution,
  real catalog pricing, billing.

## Why this matters

This is the first backend GuildCloud has ever had — every prior phase of
this project was infrastructure (Proxmox, Tailscale, backups) with a
100%-mock console sitting on top of it, disconnected from any of it. This
doesn't connect the console to Proxmox yet (that's Phase 2's site
integration), but it's the first time the console has real persistence,
real auth, and real multi-tenant boundaries instead of static arrays.
