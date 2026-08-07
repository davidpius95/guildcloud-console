---
name: guildcloud-docs
description: Write and maintain GuildCloud's project documentation — a dev log entry after every meaningful change, decision records for material choices, and phase evidence under docs/ — so the user can understand every flow and every piece of work done as the project continues. Use this after finishing any feature, fix, infrastructure survey, or non-trivial decision, and when the user asks "what happened", "explain the history", "document this", or "where are we".
---

# Documenting GuildCloud as it's built

The master plan (§1) already defines the documentation discipline this
project follows: *"Update decisions, risks, implementation evidence, and
operating runbooks as development proceeds."* This skill is how that
discipline actually gets executed in `docs/`.

## Where things go

```
docs/
  dev-log/       one dated entry per work session — what changed and why
  decisions/     Decision Records — material, hard-to-reverse choices
  phase-0/       inventory, network map, capacity model, gap register
  phase-N/       (create as later phases produce evidence)
```

Don't invent a different structure. If a new kind of artifact doesn't fit
these four, ask whether it's actually phase evidence (goes in `phase-N/`) or
a one-off decision (goes in `decisions/`) before creating a new top-level
folder.

## Dev log entries

Write one after every session that changes the codebase, the plan, or the
infrastructure — not after every single commit, but after every coherent
chunk of work. File: `docs/dev-log/<YYYY-MM-DD>-<short-slug>.md`.

Structure:

```markdown
# <Date> — <Title>

## What changed
Plain-language summary. Link commits (`git log` hash), not just describe —
the reader should be able to jump to the actual diff.

## Why
The decision or request that drove it. If it maps to a plan section or a
Table A/B item, say which.

## Verified
What you ran to confirm it worked (see guildcloud-verify-green) — don't just
assert "tested", name what passed.

## What's still open
Anything explicitly deferred, and why.
```

Keep it factual and skimmable — this is the file the user (or a future
session, or Codex) reads to answer "what happened and why" without
re-deriving it from a git diff.

## Decision records

For a **material, hard-to-reverse choice** — not every choice, per the plan's
own trigger: "before implementing a non-trivial irreversible choice." File:
`docs/decisions/<YYYY-MM-DD>-<short-slug>.md`.

Structure:

```markdown
# Decision: <title>

**Date:** <date>
**Status:** proposed | accepted | superseded by <link>

## Context
What prompted this. Link the plan section it relates to.

## Decision
What was actually decided, stated as a fact, not a discussion.

## Alternatives considered
Briefly — enough that a later reader knows this wasn't the only option, not
a full debate transcript.

## Consequences
What this makes easier, harder, or forecloses.
```

Examples of GuildCloud choices that warranted this treatment: keeping the
console in a separate repo from the existing `guildcloud` monorepo rather
than merging them; building the payment-method UI as provider-redirect
framing rather than a card-entry form, per §9's verification model.

## Phase evidence

Each phase in the plan's Implementation Plan table (§14) names required
documentation and proof. When that phase's work happens, the evidence goes in
`docs/phase-N/`, matching the artifact names the plan already specifies —
don't rename them. Phase 0's are: `site-inventory.md`, `network-map.md`,
`capacity-model.md`, `gap-register.md`. Later phases will name their own
(API contract, threat model, operator runbook, etc.) — use those exact names
so the plan and the docs stay addressable by the same vocabulary.

## What NOT to document here

- Anything derivable by reading the code (architecture, file layout) — that's
  what the code and `README.md` are for, not a doc that will drift out of
  sync with it.
- Anything that belongs in the master plan itself (scope, requirements,
  promises) — update the plan, don't fork a second copy of it into `docs/`.
- Speculative future work not yet decided — that belongs in the plan's §15
  (Future Development Roadmap) or as an open item in a dev log entry, not a
  standalone doc.

## After writing

Commit the doc in the same commit as the work it describes (or immediately
after) — a dev log entry that isn't committed doesn't survive a handoff. See
`guildcloud-context-handoff` for how this feeds a session transition.
