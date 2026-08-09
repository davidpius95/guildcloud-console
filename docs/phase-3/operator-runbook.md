# Phase 3 Slice 1 — Operator Runbook

Extends `docs/phase-2/operator-runbook.md`. Same project
(`ssbleuvjxlgttlkoancu`, `eu-west-1`) and same Guild-A LXC worker
(`vmid 500`).

## Check a project's ACL grant status

```sql
select id, name, slug, tailscale_acl_state from projects order by created_at;
```

A project stuck `pending` for more than a couple of worker ticks means
`applyPendingProjectAcls()` is failing — check the worker's own log output
(it logs `{ok: false, project_id, error}` on failure and leaves the row
`pending` to retry, deliberately not escalating to `failed` automatically).

## Rotate the Tailscale OAuth client

1. Tailscale admin console → Settings → OAuth clients → revoke the old
   client, generate a new one (same scopes: Devices Core + Auth Keys, not
   tag-restricted — see `docs/phase-3/threat-model.md` finding #2 for why).
2. Update both Vault secrets:
   ```sql
   select vault.update_secret('<secret-id-for-client-id>', '<new-client-id>');
   select vault.update_secret('<secret-id-for-client-secret>', '<new-client-secret>');
   ```
   (Look up the secret ids via `select id, name from vault.secrets where
   name like 'tailscale_%';` first.)
3. No worker restart needed — it fetches from Vault on every run.

## Revoke the old, critical exposed key

Still outstanding as of this writing — see `docs/phase-2/threat-model.md`
finding #8. Tailscale admin console → Keys → find and revoke
`tskey-auth-kHNZ...4nwHbx6Rv3`. This is independent of everything in this
phase; rotating/creating new mechanisms doesn't revoke an already-issued
key.

## Sync the live ACL policy back to git (not yet automated)

`infra/tailscale/policy.hujson` will drift from the live per-project
grants list, by design (see threat-model.md finding #3). To manually
check the live policy against git:

```
# via this session's Tailscale MCP tools, or the admin console
GET https://api.tailscale.com/api/v2/tailnet/tail345216.ts.net/acl
```

Compare the `grants` array's `tag:guildcloud-tenant-*` entries against
what's committed. A periodic automated sync-back job is flagged as
follow-up work, not built this pass.

## Guild-A LXC's own Tailscale connectivity

```bash
pct enter 500
tailscale status
```

Should show it connected, tagged `tag:guildcloud-mgmt`. If
`/dev/net/tun` ever goes missing after a container config change, device
passthrough must be re-applied from the Proxmox node itself (not via any
API token):

```bash
pct set 500 -dev0 /dev/net/tun
pct reboot 500
```

## New template in rotation

`vmid 9011` (`ubuntu-2604-guildvm-template-ts`) is now what
`catalog_image_site_templates` points Ubuntu 24.04/Guild-A at. `9010`
(no Tailscale) stays as rollback — to revert, re-run the repoint migration
with `9010` instead of `9011`. Building a future template variant: clone
from `9011` (not `9000`) to inherit the pre-baked Tailscale package
without reintroducing the removed `apt-get update`/AppStream first-boot
cost.
