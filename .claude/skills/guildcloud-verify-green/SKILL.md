---
name: guildcloud-verify-green
description: The mandatory gate before marking any GuildCloud feature, fix, or task complete — typecheck, build, and browser-verify every change, and don't start the next task until this one is fully green. Use this after every code change in this project, not just at the end of a session, because this codebase has caught real bugs (a CSS comment containing "*/" that silently broke every page, a horizontal-scroll regression, a table index bug from re-fetching after mutation) that typecheck alone would have missed.
---

# Verify-green: the gate between "written" and "done"

GuildCloud's own master plan says it plainly (§1): *"No feature is done when
code compiles. It is done only when it is documented, tested on the intended
environment, observable, recoverable, and represented honestly."* This skill
is the mechanical version of that sentence for a Next.js console.

**Do not start the next task while this one has red anywhere in the checklist
below.** Fix or explicitly flag-and-ask before moving on — don't silently
carry a known-broken state forward.

## The checklist, in order

Run these in order — each catches a different class of bug, and later steps
are pointless if earlier ones fail.

### 1. Typecheck

```bash
npx tsc --noEmit
```

Zero output = pass. Any output = stop and fix before continuing. This alone
missed the CSS-comment bug (`*/` inside `bg-ink-*/text-ink-*` silently closed
a comment early) — it's necessary but not sufficient.

### 2. Production build

```bash
npm run build
```

Must complete with all routes listed and no errors. This catches what
`tsc --noEmit` doesn't: PostCSS/Tailwind parse errors, `generateStaticParams`
failures, server/client component boundary violations. Read the route list —
a route silently missing from the output is itself a bug.

### 3. Browser verification (not optional for anything visual)

If the change touches anything rendered — a page, a component, a modal, a
style — verify it in the actual browser, not just by reading the JSX:

1. `preview_start` (name: `guildcloud`) if not already running.
2. Navigate to the affected route(s).
3. `read_console_messages` with `onlyErrors: true` — check for hydration
   warnings, runtime errors, parse errors. **Stale HMR error overlays can
   look like new failures** — if something looks wrong right after an edit,
   force-reload (`navigate` with `force: true`) before concluding it's real.
4. For interactive changes (modals, forms, confirmations): actually click
   through the flow via `computer` or `javascript_tool`, don't just confirm
   the modal opens. Every gated confirm (type-to-delete, disabled-until-valid
   buttons) should be tested in *both* the blocked and unblocked state — this
   caught real button-selector bugs in this project (regex escaping on `$`
   in button text, wrong coordinate after a `resize_window`).
5. Check both themes if the change touches shared UI (`components/ui.tsx`,
   `components/modal.tsx`) — GuildCloud's dark mode is CSS-variable-scoped to
   `.console-root`, and a change can look right in light mode while breaking
   dark.
6. Check mobile if the change touches layout — this project has a documented
   history of horizontal-scroll regressions from grid children not getting
   `min-w-0`. Resize to `mobile` preset and check
   `document.documentElement.scrollWidth <= clientWidth`.

### 4. Re-read state after mutating it

If the feature adds client-side state (a list that grows, a value that
toggles), don't infer success from the click handler running — read the
resulting DOM/text back (`get_page_text` or a targeted `javascript_tool`
query) and confirm the actual displayed value changed. This project found a
real bug this way: editing a table by re-fetching `d.tables[N]` after
inserting new tables into the same document shifted every subsequent index,
silently appending content to the wrong table.

### 5. If the change touches the master plan docx

Run the structural check before declaring the edit done — Word documents
don't error loudly on a bad insert:

```bash
python3 -c "
import docx
d = docx.Document('<path>.docx')
for i, t in enumerate(d.tables):
    print(i, len(t.rows), [c.text[:30] for c in t.rows[0].cells])
"
```
Confirm row/table counts match what you intended to add, not just that the
script ran without a Python exception.

## What "green" means before moving to the next task

- [ ] `npx tsc --noEmit` — no output
- [ ] `npm run build` — completes, full route list present
- [ ] Browser: no console errors on the affected route(s), after a forced reload
- [ ] Interactive flows clicked through in both blocked/unblocked states
- [ ] Dark mode checked if shared UI changed
- [ ] Mobile width checked if layout changed
- [ ] Any client state mutation re-read from the DOM, not assumed
- [ ] Any docx edit structurally verified (table/row counts)

Only then mark the task complete and move on.
