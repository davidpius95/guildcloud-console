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

## Rollback

```
ln -sfn /opt/guildcloud-worker/releases/<previous-timestamp> /opt/guildcloud-worker/current
systemctl restart guildcloud-worker.timer
```

Then either fix forward and let `deploy-pull.sh` redeploy on its next poll,
or revert the bad commit on `main` so the poller doesn't immediately
re-deploy the same broken release.
