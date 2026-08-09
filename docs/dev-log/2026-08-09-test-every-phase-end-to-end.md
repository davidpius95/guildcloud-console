# Dev log — 2026-08-09: test every phase built so far, end to end

## What was asked

"test every phase done so far end to end" — not a new feature, a real
verification pass across everything built: Phase 2 (durable provisioning)
and Phase 3 Slice 1 (real Tailscale private access).

## What was actually real to test

Checked live state first rather than assuming: Phase 0/1 are
survey/foundation only (nothing executable to test). Phase 2 and 3 are the
only phases with real, running behavior. Found two pre-existing anomalies
before starting anything new — `test2` (vmid 356151) and `try`, both
`instances` rows with **no matching `operations` row**, stuck showing
"Assigning…" in the console forever. Left both untouched (see
`docs/phase-2/threat-model.md` finding #11) — no operation to safely
reset, and deleting a real, running, unexplained VM without knowing its
origin isn't a call to make unilaterally.

## Real test: created an instance through the actual console UI

Not a DB-inserted test row — drove the real `create-instance-wizard` form
in the browser (Standard 1 plan, to fit the ~4.6GB currently free on
`nodeD`), submitted it, and let the real `createInstance` Server Action
and the real worker run the whole pipeline.

**Found one automation-only issue getting the form to submit:** the
wizard's visible "Instance name" input is React-`state`-controlled
(`onChange` → `setName`) and has no `name` attribute itself — the actual
submitted `name` field is a separate hidden input synced from that state.
Setting the hidden input directly (as a first pass at automating the
form) left the `canCreate` gate (`name.trim().length > 0`) permanently
false, so "Create instance" stayed disabled with no visible error. Fixed
by dispatching a real `input` event on the *visible* field instead. Not a
real user-facing bug — normal typing fires `onChange` correctly — but
worth knowing if this project ever adds automated UI tests for this
wizard.

## Result: reached `ready` for real, twice — and caught two more real bugs

The fresh instance (`phase-test-2`) hit the **exact same `tailscaled`-not-
running failure** documented in the previous Phase 3 dev-log entry — solid
proof (not just "should still be broken") that the live
`/opt/guildcloud-worker/index.js` on the Guild-A LXC still hasn't received
that fix; only the Deno source has it. Unblocked manually the same way as
before, then it reached `ready`.

**New finding this pass:** `automated_verification` reached `ready`
correctly, but the stage row was left showing `status: done` with a
**stale `error` message** from an earlier failed retry attempt still
attached (`markStage()` does a partial Postgres update and never
explicitly cleared `error` on the success path). Not a functional bug —
the operation genuinely succeeded — but a real observability trap: a
support engineer reading that row later would wrongly conclude
verification failed. Fixed generically in `markStage()` itself (clears
`error: null` by default on any `done`/`skipped` transition unless the
caller sets one) rather than patching each call site — see
`docs/phase-3/threat-model.md` finding #9.

**Also found (not fixed this pass, needs its own deliberate change):**
`capacity_reservations` are never released when their operation succeeds
— see `docs/phase-2/threat-model.md` finding #10. Every real instance
created so far, across every test this session, is still holding its
reservation.

Independently verified the second real enrollment via `list_devices` (not
trusting the worker's self-report): device `instance-b293f912`, IP
`100.99.152.83`, tags `tag:guildcloud-tenant` +
`tag:guildcloud-tenant-project-b44c4107` (the real "Production" project's
slug) — correct. Console's private-address table showed the same
IP/hostname. Also noticed the *first* test's device (`instance-4f1d652b`)
is still listed in Tailscale, `lastSeen` frozen at its deletion time —
confirms the known gap (no real `deleteInstance`, can't delete a
Tailscale device from this session either) is still real and still open.

## Cleaned up

Deleted the second test's Proxmox VM (377622) and its `operations`/
`instances` rows. Left the still-undeleteable Tailscale device
(`instance-b293f912`) for manual cleanup, same constraint as before
(`manage_keys`-class device deletion needs an admin risk level this
session doesn't have). Did not touch `test2`/`try`.

## Confirmed working end to end, for real, twice independently

- Phase 2: real console submission → durable operation → real Proxmox
  clone/config/boot → `ready`, with real capacity preflight enforcement.
- Phase 3: real per-project ACL grant application, real ephemeral
  Tailscale key mint, real enrollment, real IP/hostname written and shown
  in the console, independently confirmed via `list_devices` both times.

## Still outstanding (not new, still not this pass's job to fix)

- Live worker (`/opt/guildcloud-worker/index.js`) needs the
  `tailscaled`-enable fix and the `markStage` error-clearing fix pasted
  in — confirmed needed twice now, not a one-off.
- `capacity_reservations` never released on success (new finding, #10).
- Two orphaned `instances` rows with no `operations` row (new finding,
  #11) — needs the user's explanation or cleanup, not a guess from this
  session.
- Tailscale device deletion for both test devices — manual, admin-risk-
  level wall.
- Original exposed key revocation and Supabase service-role key rotation
  — still the user's own action items from earlier this session.
