---
name: guildcloud-standards
description: Coding conventions and software-engineering standards established in the GuildCloud console codebase — component patterns, the mock-data boundary, TypeScript discipline, and the "honest copy" rule. Use this whenever writing or reviewing code in this repo, especially when adding a new page, component, or data model, so new work matches what's already there instead of drifting into an inconsistent second style.
---

# GuildCloud engineering standards

These are the conventions this specific codebase has actually converged on —
not generic best practice. Follow them so new code reads like it was written
by the same team as the existing code.

## The mock-data boundary is load-bearing

`lib/mock-data.ts` and `lib/types.ts` are the **only** source of data. Every
page and component reads from them via plain typed imports — no fetch, no API
route, no database, until the real control plane (Phase 1) exists.

- Never add a `fetch()` call or an `app/api/` route to make something feel
  more real. If a flow needs to look interactive, mutate **local React state**
  seeded from the mock data (see `team-access-card.tsx`, `billing-workspace.tsx`
  for the established pattern: `useState(initialX)`, mutate locally, never
  write back to `lib/mock-data.ts`).
- Every mocked action that simulates a real-world side effect (a top-up, a
  restore, a webhook test ping) must say so in its confirmation text: *"This
  is a mock console — no real charge occurred."* This is not optional
  flavor text — it's the honesty discipline the plan requires (§1: "no
  feature is done when code compiles... represented honestly").
- When real backend work starts (Phase 1+), the boundary to replace is
  exactly `lib/mock-data.ts`'s exports — components should not need to change
  their shape, only where the data comes from.

## Component patterns already established

- **Shared UI primitives live in `components/ui.tsx`** (Card, Table, Badge,
  StatePill, Button, Note, Meter, PageHeader, CardHeader). Add to this file
  rather than inventing a one-off styled div — every page composes almost
  entirely from these.
- **Modals use `components/modal.tsx`**, one shared component, not bespoke
  overlays per feature.
- **Destructive actions require typed confirmation** — type the exact
  resource name to enable the confirm button. See `instance-actions.tsx`
  (`DeleteModal`, `RestoreModal`) for the reference implementation. This is a
  plan requirement (§13 Table A row 2), not just a nice pattern — reuse it,
  don't reinvent a lighter-weight confirm for a new destructive action.
- **Client components stay narrowly scoped.** A page (`app/console/.../page.tsx`)
  is a server component that fetches from mock-data and passes initial props
  to a client component that owns the interactive state — see
  `billing-workspace.tsx`, `team-access-card.tsx`, `instance-actions.tsx` as
  the pattern. Don't make an entire page `"use client"` just because one
  button needs state.
- **Icons live in `components/icons.tsx`** as inline SVG functions taking
  `className` — don't pull in an icon library.

## TypeScript discipline

- `tsc --noEmit` must be clean before any task is considered done (see
  `guildcloud-verify-green`).
- New domain concepts get a real type in `lib/types.ts`, not an inline
  object literal shape repeated across files.
- Prefer a `Record<Status, Tone>`-style lookup object over a chain of
  if/else or switch when mapping an enum-like union to a display value — this
  is the established pattern throughout the console pages.

## Styling

- Tailwind v4, configured entirely in `app/globals.css` via `@theme` — there
  is no `tailwind.config.js`. New color tokens go in that `@theme` block.
- The palette is semantic: `lemon-*` (brand/accent), `ink-*` (neutrals, text,
  borders, adaptive between themes). Don't introduce a new neutral scale.
- Dark mode is CSS-variable scoping to `.console-root` (see the comment block
  in `globals.css`) — a handful of elements are deliberately pinned to
  literal hex (logo marks, primary-button text on the lemon accent) rather
  than the adaptive tokens. If you add a new "always-dark-chip" element, pin
  it the same way (`bg-[#171d36]`), don't reuse `bg-ink-900` and expect it to
  stay dark in dark mode — it won't, by design.
- Watch for `*/` inside a CSS comment (closes the comment early — this broke
  the entire app once). Never write a literal utility-class example like
  `bg-ink-*/text-ink-*` inside a `/* ... */` block.

## Naming and honesty in copy

- UI copy states boundaries explicitly, matching the plan's own discipline:
  what a service does *and* what it doesn't do yet ("No public VPS IP or
  public SSH in the MVP"). Don't write copy that implies more than what's
  built.
- Component and file names describe what they render, not how — `Modal`, not
  `OverlayContainerWrapper`.

## Before adding a new console page

1. Check the master plan for the relevant section — does this page's content
   match what's actually promised, or does it need a plan update first (see
   `guildcloud-standards`'s sibling skill `guildcloud-product-designer` for
   the plan-fidelity check)?
2. Compose from `components/ui.tsx` primitives before writing new CSS.
3. Add the route to the sidebar (`components/sidebar.tsx`) and mobile nav
   (`components/mobile-nav.tsx`) — both, not just one; this codebase has both
   because of the responsive nav pattern.
4. Run the full `guildcloud-verify-green` checklist before considering it done.
