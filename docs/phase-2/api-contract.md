# Phase 2 — API Contract

Same framing as `docs/phase-1/api-contract.md`: internal, RLS-enforced Server
Actions, not a public API. Phase 2 adds one Server Action (customer-facing)
and one external HTTP surface (the site worker, internal-only).

## `app/console/instances/actions.ts`

### `createInstance(prevState, formData: { name, projectId, catalogImageId, catalogPlanId, siteId, idempotencyKey })`

- **RLS gate:** `has_org_role(organization_id, ['Owner','Admin'])` via both
  the `instances` and `operations` insert policies — Developer/Billing/
  Read-only roles cannot provision.
- **Idempotency:** `idempotencyKey` is generated once client-side when the
  wizard renders (`useState(() => crypto.randomUUID())`), not per submit, so
  a double-click or a client retry carries the same key. Checked first
  against `operations.idempotency_key` — if a match exists, redirects to
  the existing `instance_id` instead of creating a second operation. If two
  requests race past that initial check, the unique index on
  `idempotency_key` still catches it (`23505`), and the handler redirects
  to whichever operation actually won rather than surfacing an error for
  what is, from the user's perspective, a successful submission.
- **Server-side re-validation:** re-checks `catalog_image_site_templates`
  for the given `(catalogImageId, siteId)` before inserting anything — never
  trusts the client alone for "is this combination actually provisionable."
  Matches the wizard's own "No tested template at {site}" copy rather than
  letting an unmapped combination reach the worker and fail there instead.
- **Writes, in order:** `instances` (`state: 'provisioning'`), `operations`
  (`state: 'pending'`), 10 `operation_stages` rows (one per
  `OPERATION_STAGES` entry, all `status: 'pending'`) — ids for `instances`
  and `operations` generated client-side, same `RETURNING`+trigger caveat
  as Phase 1 (see `data-model.md`).
- **Audit event:** `instance.create_requested` (metadata: name, image,
  plan, site).
- **Errors surfaced:** missing required fields, no org, no template at
  site, and any Postgres constraint violation all return
  `{ error: string }` to the wizard's `useActionState` form state.

## `components/create-instance-wizard.tsx` — real vs. mock submission

The wizard is unchanged for every field/step — still reads
`lib/mock-data.ts` for display. Only the submit path branches:

- **Real submission** (`siteId === 'lag-1' && imageId === 'ubuntu-2404'` —
  the only combination with a row in `catalog_image_site_templates` today):
  a hidden `<form action={formAction}>` wired to `createInstance` via
  `useActionState`, submit button becomes `type="submit"`.
- **Every other combination:** unchanged mock behavior — clicking "Create
  instance" just shows the existing honest note
  ("This is a mock console — no operation was created...").

## `app/console/instances/[id]/page.tsx`

Not a Server Action, but worth documenting the branch: checks
`getInstanceWithOperation(id)` (a real `instances` row) first; if found,
renders the real provisioning-progress view
(`components/operation-progress.tsx`, polling via `router.refresh()` every
4s while the operation is non-terminal). If not found, falls back to the
existing all-mock `lib/mock-data.ts` rendering unchanged — real and mock
instances currently share the same route/id shape.

## Site worker (internal only, not customer-facing, not HTTP)

**Note on placement — see `threat-model.md` finding #1 for the full
story:** the worker was originally built as a Supabase Edge Function
(`supabase/functions/site-worker-guild-a`), invoked on a `pg_cron`
schedule. A real live test found this cannot reach Guild-A at all — Edge
Functions run on Deno Deploy's infrastructure, with no route into the
private LAN (`192.168.8.0/24`). **The worker now runs as a plain Node.js
script** (`/opt/guildcloud-worker/index.js`) on a dedicated LXC (`vmid 500`,
on `nodeD`, on Guild-A's own network), invoked by a systemd timer every
20s rather than `pg_cron` + HTTP — same one-bounded-stage-per-run contract,
just not reached over HTTP anymore. The Edge Function source is kept for
reference; its `pg_cron` schedule has been unscheduled and must stay that
way (see `threat-model.md` finding #1 for the state-corruption bug that
running both caused).

Each invocation does exactly **one bounded unit of work**, never a loop
through multiple stages:

1. Claim the oldest `lag-1` operation with `state in ('pending','running')`.
2. Find the first `operation_stages` row that isn't `done`/`skipped` for it.
3. Execute only that stage against Guild-A's real Proxmox REST API.
4. Write the stage result back (`status`, `detail`, `error`), update
   `operations.current_stage`/`updated_at`, return.

This is what makes it durable and retry-safe: state lives in Postgres
between every stage, so any invocation dying mid-way (timeout, crash,
network blip) is safely replaced by the next scheduled tick resuming from
the last `done` stage — not because any process stays alive. Verified live,
not just designed: a real operation advanced through every stage against
real Proxmox, survived two real bugs found and fixed mid-run without
redoing any already-`done` stage, and reached `ready` on a real,
subsequently-deleted VM.

**Two real Proxmox API bugs found only by testing, not documented up
front:** the clone call's `full: 0` (linked clone, for speed — see
`threat-model.md`) rejects a `storage` parameter, which is only valid for
`full: 1`; and any clone attaching a network device requires `SDN.Use` on
the SDN zone, even the plain default bridge zone, which the scoped
Proxmox token didn't originally have. Both fixed and verified live.
