# GuildCloud — console and landing page

A private-by-default cloud platform. This repository contains the marketing
landing page and the full signed-in console, backed by a real control plane
(Supabase) and a real Proxmox execution plane for the Guild Instances flow.

**Read [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) first** — it is the
continuously-updated source of truth for what's real, current architecture, and
what's in progress. This README covers only how to run the app locally.

To stand the whole platform up somewhere else — control plane, Proxmox
execution plane, Tailscale, site worker, console — follow
[`docs/REPLICATION.md`](docs/REPLICATION.md).

There is no payment processing in this repository yet.

## Running it

```bash
cp .env.example .env.local   # fill in your Supabase URL + anon key
npm ci
npm run dev
```

The dev server listens on <http://localhost:3100>. Without `.env.local` the app
builds but cannot reach Supabase, so every signed-in surface fails at runtime —
see [`.env.example`](.env.example) for what each variable is.

| Script              | What it does                       |
| ------------------- | ---------------------------------- |
| `npm run dev`       | Dev server on port 3100            |
| `npm run build`     | Production build (all pages static)|
| `npm start`         | Serve the production build         |
| `npm run typecheck` | `tsc --noEmit`                     |
| `npm test`          | Worker + UI unit tests             |
| `npm run check`     | The full gate: migrations, lint, typecheck, unit, pgTAP, build |

`npm run check` is what CI runs. The pgTAP suites (`test:db`, `test:intents`,
`test:worker-boundary`) spin up a disposable Postgres in Docker — they need
Docker running, but no live Supabase project.

## Stack

Next.js (App Router) · React 19 · TypeScript · Tailwind CSS v4.

Tailwind v4 is configured entirely in `app/globals.css` via `@theme` — there is
no `tailwind.config.js`. The palette is `lemon-*` (brand) and `ink-*` (neutrals).

## Layout

```
app/
  page.tsx              Landing page
  console/              Signed-in console (shared layout: sidebar + topbar)
    page.tsx            Dashboard
    instances/          List, [id] detail, new (create wizard)
    kubernetes/ databases/ storage/ volumes/ functions/
    networking/ monitoring/ marketplace/
    billing/ settings/ support/
components/             Shell, shared UI primitives, icons
lib/
  types.ts              Domain types
  supabase/             Browser, server and middleware clients + generated types
deploy/site-worker/     The real Proxmox site worker (runs on a per-cluster LXC)
supabase/
  migrations/           The complete control-plane schema, replayable from empty
  functions/            Edge Functions (invite email, device enrollment)
infra/tailscale/        The tailnet access policy, applied by GitHub Actions
```

**There is no mock data.** `lib/mock-data.ts` was deleted on 2026-08-25; every
console surface now renders either the signed-in customer's real data or an
explicit "Not available yet" state. Subsystem pages that have no backend yet
(Kubernetes, databases, storage, volumes, functions, marketplace, migration)
say so rather than inventing numbers. See `docs/PROJECT_STATUS.md` for what is
backed by real infrastructure today.

## Design intent

Two constraints drive the UI, both from the master plan:

1. **Density with calm.** DigitalOcean-style guided clarity plus Hetzner-style
   compact operational detail. Slow work is tracked and explained rather than
   hidden — provisioning streams its stages, and failures name the stage that
   failed.
2. **Honest copy.** Every service states its boundary in the interface: no
   public SSH route on MVP instances, no disk shrinking, dedicated Kubernetes
   clusters are future work, no untested SLA or active-active promise. Keep this
   when adding surfaces.

Prices and plan sizes in the catalogue are placeholders — every row carries
`is_placeholder = true`. Per the plan, nothing may be published before a real
site capacity model exists.

## Next steps

See `docs/PROJECT_STATUS.md` — kept current, not duplicated here.
