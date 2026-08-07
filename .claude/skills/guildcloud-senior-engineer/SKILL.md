---
name: guildcloud-senior-engineer
description: Review or write GuildCloud code with a senior software engineer's judgment — architecture fit, correctness, simplicity, and whether new work matches established patterns rather than forking a parallel style. Use this when asked to review a change, decide between implementation approaches, or when the user wants a "senior engineer" perspective on this codebase specifically.
---

# Acting as GuildCloud's senior software engineer

The lens: would this change be approved in a real code review at a company
that takes its own conventions seriously? Not "does it work" — "does it
belong here."

## What to check, in priority order

1. **Does it match `guildcloud-standards`?** Read that skill first if you
   haven't this session — a change that works but ignores the established
   component/data patterns creates a second, competing style in the same
   codebase. That's a real cost even when the diff looks clean in isolation.

2. **Is it the smallest correct change?** This project's own instructions are
   explicit: don't add abstractions, error handling, or config for scenarios
   that can't happen yet. A mock console doesn't need a retry queue. Flag
   over-engineering as seriously as you'd flag a bug.

3. **Does it actually get verified, not just written?** See
   `guildcloud-verify-green`. A senior engineer doesn't approve "should
   work" — they want to see it run.

4. **Correctness in the specific ways this codebase has been wrong before:**
   - Index-based lookups after a mutating operation (python-docx table
     insertion bug — re-fetch by identity, not position, after any insert).
   - Regex/selector escaping when matching generated text (`$` in button
     labels, `*/` in CSS comments).
   - State lifted to the wrong component (client state needs to live where
     both the trigger and the display that depends on it can share it — see
     why `billing-workspace.tsx` owns wallet balance *and* the Add Funds
     button, not split across a server PageHeader and a client card).

5. **Is the plan being followed, not just "a reasonable feature"?** Every
   console feature in this project should trace to a specific plan section.
   If it doesn't, that's not automatically wrong — but say so explicitly and
   suggest either citing the section or updating the plan, rather than
   silently building ahead of it (see `guildcloud-product-designer`).

## How to give the review

Be direct about severity — don't flatten a real bug and a style nit into the
same tone. Use the same rank/tier language this project already uses in its
own audits (MVP-critical / near-term / future / quick-win) when triaging a
list of findings, since that's the vocabulary the user and the plan both
already use.

When reviewing your own just-written code (not someone else's), this is the
skill to switch into *before* calling it done — read your diff as if someone
else wrote it.
