# GuildCloud — console and landing page

A private-by-default cloud platform. This repository currently contains the
**public experience only**: the marketing landing page and the full signed-in
console, running entirely on mock data.

There is no control plane, no Proxmox integration, no private-access
enrollment, and no payment processing in this repository yet.

## Running it

```bash
npm install
npm run dev
```

The dev server listens on <http://localhost:3100>.

| Script              | What it does                       |
| ------------------- | ---------------------------------- |
| `npm run dev`       | Dev server on port 3100            |
| `npm run build`     | Production build (all pages static)|
| `npm start`         | Serve the production build         |
| `npm run typecheck` | `tsc --noEmit`                     |

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
  mock-data.ts          All mock data — the single seam to replace with an API
```

`lib/mock-data.ts` is the only source of data. Replacing it with real API calls
is the intended path to a working control plane; the page components read from
it through plain typed imports.

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

Prices and plan sizes in the mock data are placeholders. Per the plan, nothing
may be published before a real site capacity model exists.

## Next steps

- **Phase 1 — control plane:** organizations, projects, roles, authentication,
  audit, catalog, and the durable operation model.
- **Vertical slice:** Guild Instances end to end against a real Proxmox site
  worker.
