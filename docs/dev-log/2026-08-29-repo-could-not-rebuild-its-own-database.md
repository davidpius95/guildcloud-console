# 2026-08-29 (later still) — the repository could not rebuild its own database

Started as a documentation question: *is everything needed to replicate
GuildCloud somewhere else actually in GitHub?* The answer turned out to be no,
and the reason was not a missing README.

## The finding

Applying every tracked migration, in filename order, to an empty Postgres 17
**failed 29 times out of 42** — starting at the very first file.

```
20260808194048_fix_catalog_template_site_id_to_lag1 :: ERROR: relation "catalog_image_site_templates" does not exist
20260808200100_alter_operations_for_phase2          :: ERROR: relation "operations" does not exist
20260808200500_create_instances                     :: ERROR: relation "organizations" does not exist
...
```

Phase 1 built the first control-plane objects directly against the hosted
Supabase project — dashboard and MCP — before this repository tracked
migrations. Migration history therefore began *mid-schema*. The oldest tracked
migration updates a table nothing in the repository ever creates.

Nothing about this was visible in normal work. Every migration since has been
written against a database that already had the foundation, and the live
project has it. It only surfaces the moment someone starts from empty: a new
environment, a `supabase db reset`, or a second site.

**What was missing:** eight tables (`organizations`, `memberships`, `projects`,
`audit_log`, `access_grants`, `catalog_plans`, `catalog_images`, `operations`),
eleven functions including the RLS helpers `is_org_member` and `has_org_role`
that nearly every policy in the system calls, two triggers, the catalogue seed
rows, a column on `instances`, and four worker RPCs
(`worker_get_proxmox_credential`, `worker_get_tailscale_oauth`,
`worker_holds_tailnet_housekeeping`, `worker_set_instance_ssh_password`).

That last group is worth dwelling on. A replica built from this repository
would have come up looking healthy and then failed at the first real instance
creation, because its worker could not fetch a Proxmox credential — an RPC that
existed only in production. Those four have since been committed independently
by the worker-cutover work (PRs #42 and #44), which landed while this was being
investigated, so this change no longer needs to restore them. That is a good
outcome and also the point: they were found by asking whether the repository
could rebuild itself, not by anything the running system did.

## The through-line with the rest of the day

This is the same shape as the three faults in
`2026-08-29-deploy-drift-leaked-token-and-a-delete-that-never-deleted.md`: code
and production drifting apart because nothing was checking that they agreed.
There, no CD kept boxes in step with `main`. Here, no test ever replayed
migrations from zero, so the schema in git quietly stopped being the schema in
production — and had been that way since day one.

Both were invisible for the same reason: the live system worked. Divergence
from your own source of truth does not announce itself while the running copy
is fine.

## The fix

The foundation was recovered from the live control plane (project
`ssbleuvjxlgttlkoancu`) and committed as one baseline plus two repair
migrations:

| File | Restores |
| --- | --- |
| `00000000000000_baseline_phase1_schema.sql` | the eight tables, the RLS helpers, org/invite lifecycle functions and triggers, RLS policies, catalogue seed |
| `20260808200550_baseline_instances_ssh_sync_column.sql` | `instances.ssh_keys_sync_pending`, and grants that could not run before their tables existed |
| `20260808201050_baseline_site_worker_vault_grant.sql` | the `get_vault_secret` grant, which has to land after that function is created |

The baseline deliberately reproduces the objects **as they stood before the
first tracked migration**, not as they stand today. Later migrations alter them
with plain `add column` and `drop constraint`, which are not idempotent — a
baseline holding the current shape would make the chain fail on its own
history. So `operations` omits the ten columns later migrations add, defaults
`state` to `'running'`, and excludes `'pending'` from its check constraint;
`projects` omits `slug` and `tailscale_acl_state`. Each omission is commented
with the migration that adds it back.

Three existing migrations also had latent ordering bugs, invisible on live for
the same reason as everything else here: `20260808194048` updates a table and a
column that later files create, and `20260808200332` grants on
`public.instances`, `catalog_image_site_templates` and `get_vault_secret`
before any of them exist. All are now guarded or relocated, with the reasoning
in each file.

## Verification

Not "it applies" — parity.

- All 50 migrations apply cleanly to an empty Postgres 17.
- The rebuilt schema matches production exactly: **23/23 tables, 63/63
  functions**, and an `operations` table with the same 19 columns in the same
  order.
- `npm run check` fully green: migrations, lint, typecheck, worker tests, UI
  tests, the pgTAP suites, and the build.

One ordering constraint fell out of it. `20260829230000` refuses to apply while
any enabled cluster lacks its Proxmox Vault secret — deliberately, so a broken
worker is caught at migration time rather than at 3am. A fresh project inherits
the seeded `guild-a`/`guild-b` rows, so a rebuild must seed Vault *before*
`supabase db push`, or drop those rows. Documented in REPLICATION.md §1.2 and
listed as a gap.

`instances.updated_at` was also missing from the chain, but `20260829190000`
now owns it and adds it deliberately **nullable with no backfill** — NULL means
"not updated since the column was added", and a plausible default is exactly the
bug that migration exists to remove. An earlier draft of this change added it
with `not null default now()`, which would have silently won via
`add column if not exists` and reintroduced that bug. It does not any more.

Everything added is guarded, so it is a no-op on the live project. Adopting it
there is `supabase migration repair --status applied 00000000000000`.

## Also written

- **`docs/REPLICATION.md`** — the from-zero guide: Supabase project and schema,
  Vault secret names, Auth config, Edge Functions, cluster registration; the
  Proxmox cluster/pool/storage/backup/template requirements and the exact
  `GuildCloudSiteWorker` privilege set and ACL scoping (read from the live
  cluster, not invented); the Tailscale tailnet, its two separate OAuth clients
  and the ACL GitOps flow; the worker LXC, its identity, and how to mint and
  revoke its token; Vercel and GitHub secrets; an end-to-end verification
  sequence; a full secret inventory; and an honest list of what still does not
  replicate.
- **`.env.example`** — there was none. It also names the variables that must
  *not* go in the console's environment (`SUPABASE_SERVICE_ROLE_KEY` above all,
  since a `NEXT_PUBLIC_` mistake ships it to browsers).
- **README corrections** — it still described `lib/mock-data.ts` as backing most
  subsystem pages. That file was deleted on 2026-08-25. The layout section and
  the pricing note were wrong in the same way.

## Still not replicable

The master plan (`GuildCloud-Master-Plan.docx`) lives outside git. `docs/`
references its sections constantly and it is authoritative for scope and
boundaries, so a replica gets a working system without the reasoning behind its
constraints. If this project is ever handed to anyone, that file has to travel
separately. Recorded in `REPLICATION.md` §9 alongside the smaller gaps: the
hardcoded tailnet name, the hardcoded `lag-1` site id, and the absence of any
template-build automation.
