# GuildCloud site worker - generic, per-cluster deployment

`index.js` (plus `config.js`, `routing.js`, `health-snapshot.js`,
`placement-policy.js`) is the **canonical, tracked source** for the site
worker that runs in production on every Guild-* cluster's dedicated LXC. One
package, one identity per deployment - see `config.js`'s header comment for
why nothing cluster-identifying has a default.

`deploy/site-worker-guild-a/index.js` is a thin per-cluster launcher
(`import "../site-worker/index.js"`) that exists only so that cluster's LXC
path and history stay unchanged. A Guild-B (or later) launcher directory
follows the same one-line pattern once that cluster is onboarded.

## One-time setup per cluster LXC

- Generate an ed25519 keypair at `/opt/guildcloud-worker/.ssh/deploy_key`
  (private key never leaves the box).
- Add the public half as a **read-only** deploy key on this GitHub repo -
  each cluster's LXC gets its own key, so revoking one never affects another.
- Sparse-checkout `deploy/site-worker/` **and** this cluster's launcher
  directory (e.g. `deploy/site-worker-guild-a/`) into
  `/opt/guildcloud-worker/repo`.
- Write `/etc/guildcloud/worker.env` from `env.example` in this directory,
  filled in with this cluster's real values. `chmod 600` and `chown root:root`
  it - the worker calls `fs.statSync` on startup and refuses to run
  otherwise (see `assertSecureWorkerEnvFile` in `index.js`).
- Install `guildcloud-worker.service`/`.timer` and
  `guildcloud-worker-deploy.service`/`.timer` from this directory into
  `/etc/systemd/system/`, then `systemctl enable --now` both timers.
- `mkdir -p /opt/guildcloud-worker/releases` for `deploy-pull.sh` to stage
  into.

## Shipping a change

Edit `deploy/site-worker/*.js`, commit, push to `main`. Every cluster's
`guildcloud-worker-deploy.timer` picks it up within ~2 minutes -
`deploy-pull.sh` stages the new release into its own timestamped directory,
runs `node --check` and the complete worker test suite before touching anything
live, installs locked dependencies, then atomically swaps the `current` symlink
and runs a bounded worker cycle. A failed activation automatically restores the
previous symlink. Release metadata and the commit/checksum/rollback target are
written to the release and deployment log. The previous four releases stay on disk
for rollback; nothing here needs terminal access to any LXC.

## Verifying a deployed release

```
node /opt/guildcloud-worker/current/index.js --print-config
```

Prints this cluster's identity and configuration - secret **names**, never
values (`config.js`'s `describe()`). Compare `WORKER_CLUSTER_ID` against
where you expect to be running, and confirm `PLACEMENT_CLAIM_MODE` matches
the rollout phase this cluster should be in (see
`docs/superpowers/plans/2026-08-18-multi-cluster-placement.md`).

```
node /opt/guildcloud-worker/current/index.js --health
```

Prints non-secret operational facts: worker id, cluster, auth mode, release
path, and how many seconds a `worker_token` credential has left. Exits
non-zero when the worker cannot construct a control-plane client at all, which
is what `deploy-pull.sh` gates a new release on.

## How the worker authenticates to the control plane

Set by `CONTROL_PLANE_AUTH_MODE` in `/etc/guildcloud/worker.env`:

- `service_role` (legacy) - `SUPABASE_SERVICE_ROLE_KEY`. Broad control-plane
  access: the key can read and write every table for every cluster, so a
  compromised worker is a compromised control plane.
- `worker_token` - `SUPABASE_WORKER_TOKEN`, a pre-minted JWT carrying
  `role: guildcloud_site_worker` and this worker's `worker_id`. PostgREST
  switches into a role that holds `EXECUTE` on the `worker_*` RPCs and nothing
  else: no table privileges, no `bypassrls`.

**The cluster is not in the token.** Each RPC resolves it from
`public.worker_identities`, so a stolen or copied token cannot widen its own
scope, and disabling a worker is `update public.worker_identities set
revoked_at = now() where worker_id = '...'` rather than a JWT-secret rotation.

Tailnet housekeeping (ACL reconciliation, member device enrollment, instance
device tags) is tailnet-wide rather than cluster-scoped. On the boundary path it
is granted by `worker_identities.tailnet_housekeeping`, which carries a unique
partial index so two live workers cannot both hold it; `TAILNET_HOUSEKEEPING_OWNER`
is consulted only on the legacy path, where nothing prevents two workers from
both claiming it and racing a read-modify-write of the same Tailscale policy.

To move the role:

```sql
update public.worker_identities set tailnet_housekeeping = false where worker_id = '<old>';
update public.worker_identities set tailnet_housekeeping = true  where worker_id = '<new>';
```

The two credentials are mutually exclusive: the worker refuses to start in
`worker_token` mode while `SUPABASE_SERVICE_ROLE_KEY` is still set, so a
half-finished migration cannot look complete while the broad key sits
unrotated on the box.

## Rollback

`deploy-pull.sh` rolls back on its own when a new release fails to start, or
fails `--health` within `HEALTH_TIMEOUT_SECONDS` (default 60). To roll back by
hand:

```
ln -sfn /opt/guildcloud-worker/releases/<previous-timestamp> /opt/guildcloud-worker/current
systemctl restart guildcloud-worker.timer
```

Then either fix forward and let `deploy-pull.sh` redeploy on its next poll,
or revert the bad commit on `main` so the poller doesn't immediately
re-deploy the same broken release.
