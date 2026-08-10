# Guild-A site worker — self-deploy

`index.js` here is the **canonical, real** source for what runs in
production on the Guild-A LXC (`vmid 500`, `/opt/guildcloud-worker/index.js`).
It used to only exist on that machine, hand-pasted over a terminal for
every change. Not anymore.

`deploy-pull.sh` runs on that LXC via a systemd timer
(`guildcloud-worker-deploy.timer`, every 2 minutes). It pulls this repo
with a read-only deploy key, and if `index.js` here differs from the live
file, copies it in and restarts `guildcloud-worker.timer`.

**To ship a worker change: edit this file, commit, push to `main`.** No
terminal access to the LXC needed. It's picked up within ~2 minutes.

`supabase/functions/site-worker-guild-a/index.ts` (Deno) is a separate,
older copy kept only for reference/parity — its own pg_cron schedule is
permanently unscheduled because the Supabase Edge Function runtime can't
reach Proxmox's private LAN IP at all. It is not what runs. Prefer editing
this file.

## One-time setup performed on the LXC (not repeated per-change)

- Generated an ed25519 keypair at `/opt/guildcloud-worker/.ssh/deploy_key`
  (private key never leaves the box).
- Added the public half as a **read-only** deploy key on this GitHub repo.
- Sparse-checked-out just this `deploy/` directory into
  `/opt/guildcloud-worker/repo`.
- Installed `guildcloud-worker-deploy.service`/`.timer` from this
  directory into `/etc/systemd/system/` and enabled the timer.
