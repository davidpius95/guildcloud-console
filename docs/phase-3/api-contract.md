# Phase 3 Slice 1 — API Contract

Same framing as prior phases: internal, RLS-enforced Server Actions, not a
public API. Phase 3 changes one existing action (`createProject`) and adds
new worker-internal behavior (not customer-facing, not HTTP).

## `app/(auth)/onboarding/actions.ts` and `app/console/projects/actions.ts` — `createProject`/onboarding project creation

Both now generate `slug` client-side from the project's own freshly
generated `id` (`project-<8 hex chars>`) and insert it alongside `name` —
`tailscale_acl_state` is left at its `pending` default, no Tailscale API
call in the request path. Same deferred-real-work pattern `createInstance`
already established: the actual side effect (the live ACL grant) happens
asynchronously in the site worker, not synchronously in the form
submission.

## Site worker — new behavior, no new customer-facing surface

- **`applyPendingProjectAcls()`** — runs once per worker invocation,
  before the stage-processing loop. For each `pending` project: declares
  its tag in the live ACL's `tagOwners`, appends a reachability grant,
  applies via the Tailscale API, marks `applied`. See
  `threat-model.md` for why this bypasses the GitOps-only rule for this
  one case.
- **`network_access_attach`** (previously an unconditional `skipped`
  stub) — now real. Gates on the owning project's `tailscale_acl_state`
  and guest-agent readiness (both via the existing `retry_wait` outcome),
  then mints a short-lived single-use key, enrolls the guest via
  `agent/exec`, and writes `private_ip`/`private_hostname`/
  `tailscale_device_id` to `instances`.
- **`automated_verification`** — extended (Node.js worker only) with a
  real TCP reachability/SSH-port check from the worker's own tailnet-
  joined host, in addition to the existing guest-agent ping.

No change to `OPERATION_STAGES`/`STAGE_ORDER` (`lib/operation-stages.ts`)
— the fixed 10-stage enum from Phase 2 is unchanged; only what two of the
stages actually *do* changed.

## Console — `app/console/networking/page.tsx`

Converted to an async server component. The "Private address allocation"
table now renders real rows from a new query
(`getInstancesWithPrivateNetworkForOrg`, `lib/supabase/queries.ts`) via a
new `components/private-address-table.tsx`, following the same
query-function → server-component-props pattern already established for
`ssh-keys-card.tsx`. "Network zones," "Site connectivity," and "Enrolled
devices" stay mock — not this slice's scope (no second real site, no real
device self-enrollment yet).
