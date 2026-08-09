# Phase 2 — Data Model

**Built:** 2026-08-08, layered on the Phase 1 schema in the same Supabase
project (`ssbleuvjxlgttlkoancu`). Migrations are checked into
`supabase/migrations/` starting this phase — Phase 1's entire schema was
applied live via MCP with nothing committed to git, reconstructed only in
prose in `docs/phase-1/data-model.md`. That gap is not repeated here.

## Extensions enabled

`pg_cron` and `pg_net` — neither was installed before this phase (confirmed
live via `list_extensions`, not assumed). `pg_net` was first created in the
`public` schema by mistake (Supabase advisor flagged "Extension in Public");
fixed by dropping and recreating it in the `extensions` schema, since
`ALTER EXTENSION ... SET SCHEMA` isn't supported for `pg_net`.

## `operations` (altered)

Phase 1 left this schema-only (`state` ∈ `running, succeeded, failed`, a
`stages jsonb` blob nothing ever wrote to). Phase 2 adds the columns the
real durable-operation model needs:

| Column | Type | Notes |
| --- | --- | --- |
| `idempotency_key` | text, not null, unique | client-generated once per wizard render, not per submit — a double-click or client retry reuses the same key and redirects to the existing operation instead of creating a second one |
| `instance_id` | uuid → `instances`, nullable, `on delete set null` | |
| `site_id` | text, not null, default `'lag-1'` | see "site_id naming" below |
| `current_stage` | text, nullable | denormalized copy of whichever `operation_stages` row is currently being worked, for cheap display without a join |
| `failure_reason` | text, nullable | |
| `updated_at` | timestamptz, not null, default `now()` | |

`state` check constraint widened to `pending, running, succeeded, failed,
cancelled`. `pending` is the real gap Phase 1 didn't have: the interval
between "operation row created" and "a worker actually picked it up" — the
`stages jsonb` column stays for backward compatibility with Phase 1
reads/writes.

**Real gap found and fixed:** Phase 1 shipped `operations` with a select-only
RLS policy — no insert policy existed at all. Fixed via a new policy:
`insert` gated on `has_org_role(organization_id, ['Owner','Admin'])`, same
shape as `projects`'s insert policy.

## `operation_stages` (new)

Replaces the `stages jsonb` blob with real rows — this is what the console
UI polls to show progress, and what makes resume mechanical: the worker's
first move on every invocation is finding the first non-`done`/`skipped` row
for an operation and resuming exactly there, never restarting from scratch.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid, pk | |
| `operation_id` | uuid → `operations`, `on delete cascade` | |
| `stage` | text, check ∈ fixed enum (below) | |
| `status` | text, check ∈ `pending, active, done, failed, skipped`, default `pending` | |
| `attempt` | int, default 0 | bumped each time a worker picks the stage up, whether or not it succeeds |
| `started_at` / `finished_at` | timestamptz, nullable | |
| `detail` | jsonb, default `{}` | stage-specific result data (e.g. `{"vmid": 123456}` for `proxmox_api_call`) |
| `error` | text, nullable | |

Unique `(operation_id, stage)`. Stage enum, matching master plan §5's
operation flow exactly, and shared in application code via
`lib/operation-stages.ts` (the site worker keeps its own literal copy since
it runs in a separate Deno/Node runtime that can't import that file):

```
preflight, capacity_reservation, operation_created, site_worker_dispatch,
proxmox_api_call, template_cloud_init, network_access_attach,
backup_monitoring_attach, automated_verification, ready
```

`network_access_attach` and `backup_monitoring_attach` exist in the enum for
shape-completeness with §5 but are marked `skipped` immediately by the
worker — private-access enrollment is Phase 3, real PBS backup attachment is
future work, neither exists yet. Marked `skipped`, never silently `done` —
the console UI should render this honestly, not as if something happened.

## `capacity_reservations` (new)

A hold, not a commit. `expires_at` (default `now() + 15 minutes`) means a
crashed worker's claim on RAM ages out and frees back rather than leaking
capacity forever.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid, pk | |
| `operation_id` | uuid → `operations`, `on delete cascade` | |
| `site_id`, `node` | text, not null | |
| `vcpu` | int, not null | |
| `memory_gb`, `disk_gb` | numeric, not null | |
| `state` | text, check ∈ `held, committed, released`, default `held` | |
| `created_at` | timestamptz | |
| `expires_at` | timestamptz, default `now() + interval '15 minutes'` | |

RLS enabled, deliberately no policy for `anon`/`authenticated` at all —
internal-only, written only by the site worker's own credential (see
`threat-model.md`). Preflight always checks
`live_node_available - sum(held, unexpired) - requested`, node-scoped (not
cluster-averaged), matching `docs/phase-0/capacity-model.md`'s own finding
that per-node placement is what actually binds.

## `catalog_image_site_templates` (new)

Resolves the real mismatch between seeded placeholder `catalog_images`
(Ubuntu 24.04, etc. — copied verbatim from `lib/mock-data.ts`) and the real
templates that exist on Guild-A (Ubuntu 26.04, Debian 13, Fedora 43, Rocky
10.2, AlmaLinux 10.2), without silently renaming either side.

| Column | Type | Notes |
| --- | --- | --- |
| `catalog_image_id` | text → `catalog_images` | |
| `site_id` | text | |
| `proxmox_vmid` | int | |
| `proxmox_node` | text | |
| `proxmox_storage` | text | |

Primary key `(catalog_image_id, site_id)`. Public-read RLS policy — the
wizard needs to check "is there a tested template at this site for this
image" for every visitor, not just signed-in org members.

**Seeded exactly one row this phase:** originally `('ubuntu-2404', 'lag-1',
9000, 'nodeD', 'ceph-vm')`, **updated 2026-08-09 to `proxmox_vmid = 9010`**
— a rebuilt template (`ubuntu-2604-guildvm-template-fast`) with no
cloud-init vendor-data step, built after a real speed investigation found
the original template's vendor snippet ran a synchronous `apt-get update`
+ Tailscale install on every clone's first boot (see
`threat-model.md` findings #8–#9 for the full story, including a critical
exposed-credential finding in that same snippet). The original template
(`9000`) is untouched, kept as rollback. The catalog-image-id/real-template
version mismatch (24.04 vs. the real 26.04-based template) is accepted the
same way Phase 1 accepted the images/plans version mismatch — noted here,
not silently renamed. No other catalog image has a row yet; the wizard's
existing "No tested template at {site}" copy is exactly what drives that for
every other combination once this table is the source of truth for it.

## `instances` (new)

The real table `operations.instance_id` points at, and what eventually
replaces `lib/mock-data.ts`'s `Instance[]` for real organizations.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid, pk | |
| `organization_id` | uuid → `organizations` | |
| `project_id` | uuid → `projects` | |
| `site_id` | text, not null | |
| `proxmox_vmid`, `proxmox_node` | nullable | filled in by the worker once the real clone exists |
| `name` | text, not null | |
| `catalog_image_id` → `catalog_images`, `catalog_plan_id` → `catalog_plans` | not null | |
| `private_ip` | inet, nullable | **not populated yet** — Phase 3 (private access) |
| `password_ssh_enabled` | boolean, not null, default `false` | opt-in per master plan §10; see `ssh_keys` below and `threat-model.md` finding #7 |
| `state` | text, check ∈ `provisioning, ready, degraded, stopped, failed, deleting`, default `provisioning` | |
| `created_at` | timestamptz | |

RLS: `select` via `is_org_member(organization_id)` (same pattern as
`projects`). `insert` gated on `has_org_role(organization_id,
['Owner','Admin'])` — the creating user's own session inserts the
`provisioning` row via `createInstance`. **No client `update` policy at
all** — only the site worker's own credential may change
`state`/`proxmox_vmid`/`proxmox_node` afterward (see `threat-model.md`).

## `ssh_keys` (new)

Backs a real per-org SSH key feature — Phase 1 shipped a Settings-page card
for this that was purely mock (hardcoded array, no `onClick`s at all).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid, pk | |
| `organization_id` | uuid → `organizations` | |
| `name` | text, not null | user-supplied label, e.g. "laptop" |
| `public_key` | text, not null, check `^(ssh-ed25519\|ssh-rsa\|ecdsa-sha2-[a-z0-9-]+) ` | light format validation only, not full key parsing |
| `created_at` | timestamptz | |

RLS: `select` via `is_org_member`; `insert`/`delete` via
`has_org_role(['Owner','Admin'])`. Every key an org has added is injected
into every new clone's cloud-init `sshkeys` field by the worker's
`template_cloud_init` stage — see `threat-model.md` finding #7.

## Password SSH — Vault-backed, reveal-once (new functions)

- **`public.set_vault_secret(p_secret_name text, p_secret_value text)`** —
  `security definer`, write-side counterpart to `get_vault_secret`. Granted
  only to `service_role` (and `site_worker_guild_a`, unused — see
  `threat-model.md` finding #2). Used by the worker to stash a freshly
  generated instance password when `password_ssh_enabled` is true.
- **`public.reveal_instance_ssh_password(p_instance_id uuid) returns text`**
  — `security definer`, with its own internal `has_org_role` check (same
  pattern as `log_audit_event`'s Phase 1 hardening — safe to grant to every
  `authenticated` user because the function itself refuses on behalf of
  anyone who isn't Owner/Admin of the instance's own org). Reads the Vault
  secret named `instance_ssh_password_<instance_id>` and **deletes it in
  the same call** — a second call for the same instance always returns
  `null`, never the same password twice. This is the closest honest
  implementation of master plan §10's "never stored by GuildCloud" for a
  value generated asynchronously by a worker and read later from the
  console, rather than shown synchronously at creation like the mock
  storage-keys "reveal once" pattern.

## `site_id` naming — a real mismatch found and fixed mid-phase

Every Phase 2 migration and the first worker draft used `site_id =
'guild-a'`, matching the real infrastructure's own naming. But
`lib/mock-data.ts`'s `sites` array — which the wizard actually reads and
submits — uses purely fictional, customer-facing ids (`lag-1`, `abj-1`,
`ams-1`) that were **never mapped to real infrastructure naming** before
this phase. `lag-1` ("Lagos 1" in the picker) is the default/primary mock
site and the one essentially all existing mock `Instance` records already
default to, so it's the id treated as backed by real Guild-A hardware.
Found via `grep` before the console's submission path was wired up (not
after a real instance silently failed to be picked up by the worker).
Fixed via the `fix_catalog_template_site_id_to_lag1` migration
(`catalog_image_site_templates.site_id` and `operations.site_id`'s default,
both updated from `guild-a` to `lag-1`) plus a global find-replace in the
worker source. `abj-1`/`ams-1` stay purely fictional until a second real
site exists (blocked on Phase 0 gap G-13).

## Helper reuse from Phase 1

`is_org_member`, `has_org_role`, `log_audit_event` are all reused as-is —
`createInstance` calls `log_audit_event` for `instance.create_requested`
exactly like `app/console/projects/actions.ts` does for
`project.created`.

## `RETURNING` + trigger caveat still applies

Same as Phase 1: `instances.id`/`operations.id` are generated client-side in
`createInstance`, and neither insert chains `.select()` — nothing depends on
`RETURNING`'s implicit SELECT-policy check seeing a same-transaction
trigger's write.

## Verification performed

- `list_tables`/`information_schema.columns` checked directly against this
  doc before writing insert logic, after Phase 1's own doc was found to be
  stale (see `docs/phase-1/data-model.md`'s correction note).
- `get_advisors(type: "security")` re-run after all Phase 2 migrations.
- Live capacity numbers used for the preflight design (`get_node_status` on
  nodeD, not the Phase 0 survey doc) — see `threat-model.md` for why a stale
  written number would be actively dangerous here.
