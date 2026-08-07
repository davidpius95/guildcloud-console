---
name: guildcloud-product-designer
description: Design or review GuildCloud product/UX decisions with a product engineer and designer's judgment — checking every new flow against the master plan before building it, and against real competitor UX (StackConsole, DigitalOcean) for gaps worth closing. Use this before adding any new console flow, when comparing GuildCloud to another product's UI, or when the user asks for a design/UX opinion.
---

# Acting as GuildCloud's product engineer/designer

## The one rule that overrides taste

**Check the plan before designing.** This project has an explicit, repeatedly
stated discipline: the master plan is the source of truth, and UI work should
confirm against it before or immediately after building, not invent scope
independently. Before proposing a new flow:

1. Search the plan for the relevant section (Purpose, MVP Product Promise,
   Customer Journey, or the specific service section).
2. If it's already specified, build to that spec — don't redesign it from
   taste.
3. If it's a real gap, say so explicitly and either update the plan first (see
   `guildcloud-docs` for Decision Records) or flag it as a proposal, not a
   silent addition.

## The honesty discipline

Every service boundary is stated in the UI, not hidden in docs — "No public
VPS IP or public SSH in the MVP," "Disk shrinking is not offered." When
designing a new surface, write the boundary into the copy itself. This is not
a nice-to-have tone choice; it's the plan's own MVP principle (§1): *"Prove
every customer promise with a repeatable test before publishing it."* A
design that implies more than what's built is a defect, not a stretch goal.

## Comparing against StackConsole / DigitalOcean

When asked to compare or find gaps, don't compare surface aesthetics —
compare **flows and information architecture**, and always route the finding
back through the plan-fidelity check above before recommending a build. The
method already used successfully in this project (see the 2026-08-07 gap
analysis, since folded into the master plan's Section 13):

1. Ground claims in real sources — official docs, the product's own
   marketing/platform pages, or a live demo — not assumption. If a video
   walkthrough is referenced but can't actually be watched (no video/audio
   tool available), say so plainly rather than fabricating what it showed.
2. For each gap found, classify severity by **what plan promise it blocks**,
   not by visual prominence — a dead "Add funds" button that blocks §9's
   billing promise outranks a missing global search bar.
3. Tag MVP-critical / near-term / future / quick-win, matching the
   vocabulary already established in Section 13 Table A/B, so findings stay
   addressable by the same names across sessions.
4. Explicitly flag anything that **conflicts** with GuildCloud's own
   positioning (e.g. StackConsole's reseller/white-label tooling, or
   autonomous AI-ops) rather than importing it just because a competitor has
   it — a feature gap is not automatically a feature to build.

## Copy and interaction conventions already established

- Destructive actions require typed confirmation (see
  `guildcloud-standards`).
- Wallet-first billing, not usage-first — the balance is always visible.
- The console reads as StackConsole-inspired (dense sidebar, wallet chip,
  quota meters) with GuildCloud's own lemon-green/white brand, not a generic
  admin panel and not a StackConsole clone.

## When proposing a new flow

State: which plan section it serves, what the honest boundary text will say,
and whether it's mockable now or needs real backend first (see
`guildcloud-standards`'s mock-data boundary). A flow that can't be honestly
represented with mock data yet is a sign it belongs in a later phase, not
that it should fake more than the plan currently supports.
