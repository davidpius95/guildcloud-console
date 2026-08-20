# Guild-A site worker - launcher

`index.js` here is a one-line launcher (`import "../site-worker/index.js"`)
identifying this deployment as Guild-A via `/etc/guildcloud/worker.env` (see
`env.example` in this directory for the exact values). The real, canonical
worker source, its tests, and its deployment mechanism all live in
`deploy/site-worker/` - see `deploy/site-worker/README.md` for setup,
shipping a change, verifying a deployed release, and rollback.

This directory exists only so the production LXC (`vmid 500`,
`/opt/guildcloud-worker/repo/deploy/site-worker-guild-a/`) keeps a stable
sparse-checkout path and its existing deploy history. Do not add worker
logic here - it belongs in `deploy/site-worker/`.

`supabase/functions/site-worker-guild-a/index.ts` (Deno) is retired: a
permanent 410 notice, not a working copy - see that file's own header
comment for why (the Edge Function runtime cannot reach Proxmox's private
LAN IP at all).

## Do not merge to `main` without also updating the live LXC's deploy setup

The production LXC's `deploy-pull.sh` (still `guildcloud-worker-deploy.timer`
-> `guildcloud-worker-deploy.service` on the box today) sparse-checks out
**only** `deploy/site-worker-guild-a/` and copies its single `index.js` to
`/opt/guildcloud-worker/index.js`. That file now does
`import "../site-worker/index.js"` - on the LXC's sparse checkout, that
sibling directory does not exist, so the next auto-deploy would copy in a
launcher that fails to import and crashes on start.

Landing this safely means, in order, per Phase R1 of
`docs/superpowers/plans/2026-08-18-multi-cluster-placement.md`:
1. Widen the LXC's sparse-checkout to include `deploy/site-worker/` too.
2. Switch the LXC's systemd units to the generic ones in
   `deploy/site-worker/` (`guildcloud-worker.service`/`.timer`,
   `guildcloud-worker-deploy.service`/`.timer`), which stage the whole
   directory and run `current/index.js` directly - no launcher indirection
   needed at runtime once this is done.
3. Only then merge/push this branch's worker changes to `main`.

Until that migration happens on the real LXC, this branch's worker code is
safe to have in git (nothing here pushes to `main` or touches the LXC on its
own) but is **not** safe to merge un-migrated.
