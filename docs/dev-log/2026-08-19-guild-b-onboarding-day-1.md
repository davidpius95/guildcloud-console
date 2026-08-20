# Dev log — 2026-08-19: multi-cluster placement code, Guild-B onboarding day 1

## Code (Tasks 4-8, all merged into this branch, all tests green)

Per `docs/superpowers/plans/2026-08-18-multi-cluster-placement.md`, Tasks
1-3 (placement policy, schema, atomic RPC) were already done. Today's
session did the remaining code-only work, plus live Guild-B onboarding.

- **Task 4** — `deploy/site-worker/index.js`/`config.js`/`routing.js`: the
  Guild-A worker moved and made cluster-neutral. Fixed two real bugs found
  by reading the live code, not the original plan doc:
  - **Snippets wrote to the worker's own node's disk**, not an API call
    (Proxmox has none) — worked only because the worker and every VM lived
    on nodeD. Fixed to require a shared `SNIPPETS_DIR`/`SNIPPETS_STORAGE_ID`.
  - **Cross-cluster deletion hazard**: `processPendingInstanceDeletions`
    had no cluster filter and a hardcoded node; since instance VMID
    uniqueness became per-cluster, a Guild-B deletion could have made the
    Guild-A worker delete the wrong Guild-A VM. Fixed with
    `assertOperationOwnership` (`deploy/site-worker/routing.js`) on every
    Proxmox-touching call site.
  - `deploy/site-worker-guild-a/index.js` is now a 1-line launcher. The
    dead Deno copy (`supabase/functions/site-worker-guild-a/index.ts`) is
    now a permanent 410 notice.
- **Task 5** — `catalog_image_cluster_node_templates` (new migration
  `20260819090000`): per-node template resolution, since Guild-B's
  `local-lvm` is per-node (unlike Guild-A's shared `ceph-vm`) and a
  template on one node isn't clonable onto another.
- **Task 6** — `deploy/site-worker/health-snapshot.js` +
  `touch_worker_heartbeat`/`publish_cluster_snapshot` RPCs (migration
  `20260819100000`): the previously-missing capacity/heartbeat publish
  path. Verified shared-storage collapse (one row, not one per node) and
  per-node storage separation against real fixture shapes from both
  clusters.
- **Task 7** — `route_operation_by_instance` trigger +
  `catalog_image_site_availability()` RPC (migration `20260819120000`):
  lifecycle operations (resize/snapshot/restore/delete) are now routed by
  a DB trigger reading the instance's own `cluster_id`/`proxmox_node`/
  `storage_id`, not by app code — misrouting is now structurally
  impossible from any insert path. Also added `instances.storage_id`
  (was missing; the worker needs it per-instance since storage is no
  longer implied by cluster alone).
- **Task 8** — generic systemd units, `deploy/site-worker/deploy-pull.sh`
  (stages a full directory, `node --check`s every file, atomic symlink
  swap, keeps 4 prior releases), `assertSecureWorkerEnvFile` (refuses to
  start on a non-`root:root 0600` env file), `--print-config`.

**Verified**: 91 worker unit tests, 281 pgTAP assertions across 6 suites
(real Docker/Postgres 17 via `scripts/test-multi-cluster-schema.sh`),
`npm run typecheck`, `npm run build` — all green.

**Known follow-up, flagged not fixed**: merging this branch to `main`
as-is would break Guild-A's live LXC's next auto-deploy, because its
sparse-checkout only pulls `deploy/site-worker-guild-a/` and the new
launcher imports a sibling directory that wouldn't exist there. See the
"Do not merge" section in `deploy/site-worker-guild-a/README.md` for the
required migration order before this branch ships.

## Live Guild-B infrastructure (§2 of the plan)

All actions below were taken with explicit per-step confirmation, per the
plan's own risk flags.

- **Fixed a pre-existing, unrelated production issue**: `guild-pbs` PBS
  storage was inactive (`active: 0`) on *both* clusters — the PBS
  server's TLS cert at `192.168.8.126` had rotated
  (`02:78:95:2a:...`) without either cluster's storage config being
  updated (still pointing at the old `5a:4f:a2:0f:...` fingerprint), so
  all backups on both clusters were silently failing. User confirmed the
  rotation was intentional; updated both clusters' `guild-pbs` storage
  fingerprint. Both active again.
- **Created `siteworker-guild-b@pve`**: a dedicated least-privilege
  identity mirroring Guild-A's real `siteworker-guild-a@pve` pattern
  (found live, not guessed) — new role `GuildCloudSiteWorker` (same
  privilege set as Guild-A's), ACLs scoped to `/nodes/podD` (chosen worker
  host), `/pool/guildcloud-guild-b`, and Guild-B's three storage targets
  (`local-lvm`, `local`, `guild-pbs`) — nothing at `/`. Token
  `siteworker-guild-b@pve!site-worker` stored in Supabase Vault as
  `proxmox_guild_b_site_worker_token`, `privsep=0` (matches Guild-A).
  Explicitly did *not* reuse the pre-existing broader `guildcloud@pve`
  account (a separate read-only inventory-agent identity, unrelated to
  this worker).
- **Created pool `guildcloud-guild-b`.**
- **Backed up all 6 Guild-A templates** (9020 ubuntu-tsbaked, 9001
  debian-13, 9003 fedora-43, 9004 rocky-10, 9005 alma-10, 9006 arch) to
  the shared PBS server's root namespace, one at a time, bandwidth-capped
  at 50MB/s, watching Ceph between each. All `exitstatus: OK`.
- **Read-only cross-cluster PBS import**: added Guild-B storage
  `guild-pbs-import` pointing at the same PBS server/datastore
  (`guild-a-standard`), root namespace, using a *user-provided* PBS token
  (`backup@pbs!cloud`, stored in Vault as
  `pbs_guild_a_readonly_import_token`). Hit two real PBS permission
  gotchas along the way, both since fixed on the PBS side by the user:
  1. `DatastoreAudit`-level access is enough to *list* snapshots but not
     to actually restore their data (`proxmox-backup-client restore`
     failed with "no permissions on /datastore/guild-a-standard" even
     though listing worked).
  2. PBS API tokens are privilege-separated from their owning user by
     default — an ACL granted to `backup@pbs` did not extend to
     `backup@pbs!cloud`; the token needed its own explicit ACL entry.
- **Restored all 6 templates onto podA** (VMIDs 9101-9151, reserving the
  9100-9199 block for Guild-B templates), via `qmrestore` +
  `--storage local-lvm`. All `exitstatus: OK`; each carries `template: 1`
  and the correct `cicustom` snippet reference from the source backup.

## Deliberately paused, not forgotten

- **Shared NFS snippets storage** (the fix for the snippet-node-mismatch
  bug above, needed for any multi-node placement including Guild-A's own
  eventual 5-node widening) — user is provisioning the export themselves;
  not yet ready.
- **Disposable-VM validation on podA** — blocked on the above (the
  worker's live per-instance snippet write needs the shared storage to
  land somewhere every node can read).
- **Fan-out to podE/podF** (12 more restores, same recipe) — deliberately
  held until podA's templates pass validation, so an unproven recipe
  doesn't get copied to two more nodes for nothing.
- Everything in `catalog_image_cluster_node_templates` for Guild-B stays
  `enabled=false` until validation passes, per the schema's own
  `enabled` requires `tested_at` constraint.

## Environment note for next session

`docs/phase-2/operator-runbook.md`'s existing "Rotate the worker's
Supabase service-role key" section already flags that key as
chat-pasted and compromised. Today added two more Vault secrets
(`proxmox_guild_b_site_worker_token`,
`pbs_guild_a_readonly_import_token`) via direct `execute_sql` calls
against the Supabase project rather than pasted in chat — neither secret
value appears anywhere in this session's transcript. The PBS token
values the user pasted directly in chat
(`root@pam!guildcloud`, superseded, and `backup@pbs!cloud`, currently
live) should be treated as chat-compromised and are candidates for
rotation once Guild-B onboarding is otherwise complete.
