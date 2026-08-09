# Phase 2 — Operator Runbook

Extends `docs/phase-1/operator-runbook.md`. Same project
(`ssbleuvjxlgttlkoancu`, `eu-west-1`).

## Site worker — where it actually runs

The worker is a plain Node.js script (`/opt/guildcloud-worker/index.js`) on
a dedicated LXC (`vmid 500`, `guildcloud-site-worker-guild-a`, on `nodeD`,
on Guild-A's own network) — **not** a Supabase Edge Function. The Edge
Function version (`supabase/functions/site-worker-guild-a`) is kept in
source for reference/parity but its `pg_cron` schedule has been
unscheduled (`select cron.unschedule('site-worker-guild-a')`) — it cannot
reach Guild-A's private LAN at all, and running it alongside the real
worker caused a real state-corruption bug (see `threat-model.md` finding
#1). **Do not re-schedule it.**

Driven by a systemd timer (`guildcloud-worker.timer`, `OnUnitActiveSec=20s`)
as a crash-resume safety net, but **each run loops internally** through as
many stages/operations as it can within ~150s rather than doing exactly
one stage per run — found live that one-stage-per-run meant even no-op
administrative stages paid the full external tick cadence, so a real
submission sat idle for over 8 minutes total. The service unit's
`TimeoutStartSec` was raised from systemd's 90s default to `300` to give
the loop room to run without being killed mid-provision.

```bash
systemctl status guildcloud-worker.timer   # confirm it's active
systemctl status guildcloud-worker.service # last run's exit status
journalctl -u guildcloud-worker.service -n 50 --no-pager
```

Real measured timing after this fix: the eight administrative/clone/config
stages complete in ~24.5s total; the dominant remaining cost is real guest
boot time (`automated_verification` waiting for the QEMU guest agent —
~2m11s in one observed run), which is a guest-image question, not
something this worker's timing controls.

Credential: `/etc/guildcloud/worker.env` on the LXC holds
`SUPABASE_SERVICE_ROLE_KEY` (root-only, `chmod 600`). This is a stated
trade-off, not the original least-privilege design — see `threat-model.md`
finding #2 for why the scoped-Postgres-role approach didn't survive real
testing (Supavisor pooler rejects ad-hoc roles; no IPv6 on this network for
the direct-connection path).

## Check whether the site worker is advancing operations

```sql
select o.id, o.state, o.current_stage, o.failure_reason, o.updated_at
from operations o
where o.site_id = 'lag-1' and o.state in ('pending','running')
order by o.updated_at asc;

select stage, status, attempt, error
from operation_stages
where operation_id = '<operation-id>'
order by array_position(
  array['preflight','capacity_reservation','operation_created',
        'site_worker_dispatch','proxmox_api_call','template_cloud_init',
        'network_access_attach','backup_monitoring_attach',
        'automated_verification','ready'],
  stage
);
```

If an operation's `updated_at` is stale (older than a few worker-poll
intervals) while `state` is still `pending`/`running`, the worker isn't
running or isn't reaching the database — check the worker process itself
before assuming a Proxmox-side problem.

## A stuck or failed operation

- **`failed`**: `operations.failure_reason` has the real error (the worker
  writes it verbatim, not a generic message). Check whether it's a
  transient Proxmox/network error (safe to let the customer retry, which
  creates a fresh operation) or a real capacity/config problem.
- **Retry semantics:** the worker resumes from the first non-`done`/
  `skipped` stage on every invocation — a failed stage does **not**
  auto-retry (marking `failed` also marks the parent `operations.state =
  'failed'`, which removes it from the worker's claim query entirely).
  There is currently no operator "retry this operation" action — the only
  path today is deleting the stuck rows and having the customer resubmit,
  or (once built) a dedicated retry action that resets the failed stage to
  `pending` and the operation back to `pending`.
- **No infra side-effect until `proxmox_api_call` succeeds** — an operation
  that failed at `preflight` or `capacity_reservation` never touched
  Proxmox at all; safe to delete outright (`delete from operations where
  id = '...'` — cascades to `operation_stages`; `instances` needs its own
  explicit delete, it isn't a child of `operations`).

## Manual cleanup after a real test provisioning run

1. Confirm the actual Proxmox side effect before deleting anything —
   `get_vm_status(node, vmid)` for the `instances.proxmox_vmid` value.
2. Delete the real VM if it exists (`delete_vm`, or `pve_call DELETE
   nodes/{node}/qemu/{vmid}`, `force: true` if still running).
3. Confirm capacity actually returned — fresh `get_node_status` call on the
   node, not just that the guest disappeared from a list.
4. Delete the test `instances`/`operations` rows (or keep one `succeeded`
   record as documented evidence — decide per test, not by default).

## Rotate the Proxmox site-worker token

Token is `siteworker-guild-a@pve!site-worker`, stored in Supabase Vault as
secret `proxmox_guild_a_site_worker_token`. To rotate:

1. Create a new token under the same user (`POST
   /access/users/siteworker-guild-a@pve/token/<new-token-name>`,
   `privsep: 0`).
2. Update the Vault secret value (`select
   vault.update_secret('<secret-id>', '<new-value>')`).
3. Confirm the worker picks up the new value on its next invocation (it
   fetches from Vault on every run, not cached).
4. Revoke the old token (`DELETE
   /access/users/siteworker-guild-a@pve/token/site-worker`).

## Rotate the worker's Supabase service-role key

**Overdue as of this writing** — the current value was pasted into a chat
session during initial setup and must be treated as compromised.

1. Supabase dashboard → this project → Settings → API → roll the
   `service_role` key.
2. On the LXC: `nano /etc/guildcloud/worker.env`, replace
   `SUPABASE_SERVICE_ROLE_KEY` with the new value, save.
3. `systemctl restart guildcloud-worker.timer` (or just wait for the next
   tick — `EnvironmentFile` is re-read per run since each run is a fresh
   process, not a long-lived one).
4. Confirm with `journalctl -u guildcloud-worker.service -n 20` that the
   next run succeeds against the new key.

## The scoped Postgres role that didn't end up in use

`site_worker_guild_a` (created, granted, RLS-scoped to `site_id='lag-1'`)
still exists in the database but nothing connects as it — the worker uses
the service-role key instead (see `threat-model.md` finding #2). Left in
place rather than dropped, in case the Supavisor/IPv6 blockers get resolved
later and this becomes usable. If reviving it: `alter role
site_worker_guild_a with password '<new-strong-password>';`, then update
wherever the worker process would hold that value.
