# Dev log — 2026-08-10: real worker deploy pipeline (Phase 0 of team-access plan)

## What was asked

Before building three more worker-touching features (SSH key retroactive
push, device enrollment sync, and their follow-ons), fix the recurring
pain point from earlier this session: every worker-side fix (the
`tailscaled` enable fix, the stale-error clearing fix) needed manual
copy-paste into `/opt/guildcloud-worker/index.js` over a terminal, because
the tracked Deno Edge Function (`supabase/functions/site-worker-guild-a`)
isn't what actually runs — it can't reach Proxmox's private LAN IP from
Supabase's cloud runtime, which is exactly why the real worker was moved
to a Guild-A-resident LXC (`vmid 500`) back in Phase 2.

## Real blocker found immediately: wrong assumption about the LXC

The original plan assumed the Proxmox QEMU guest-agent file-write API
(`POST /nodes/{node}/qemu/{vmid}/agent/file-write`) could push the file
directly, the same way this session had already been fixing things
in-place on QEMU VMs all day. **Vmid 500 is an LXC container, not a QEMU
VM** — confirmed via `get_containers`. Proxmox has no REST API equivalent
of guest-agent exec/file-write for LXC at all (confirmed: `pve_find_endpoint
"lxc exec"` returns nothing). The remote Proxmox MCP server's
`execute_container_command` tool consistently timed out against this
container too.

**Real fix, not a workaround:** the user had already patched the *local*
Proxmox MCP server to run `pct exec` over SSH to the hosting node
(`mcp__ProxmoxMCP-Plus__execute_container_command`, `backend: "ssh"`) —
confirmed working live (`wc -l /opt/guildcloud-worker/index.js` → real
output). The equivalent fix hasn't shipped to the remote server yet, so
this and future worker-adjacent LXC work in this session uses the local
server specifically.

## What was built

Rather than keep manually execing into the container for every change,
built a real self-deploy pipeline:

- `deploy/site-worker-guild-a/index.js` — the actual, current, real
  worker source **committed to git for the first time**. It only ever
  existed on the LXC before, hand-pasted in. Pulled the live file
  (`cat`, 369 lines) and committed it verbatim as the new canonical
  source. `supabase/functions/site-worker-guild-a/index.ts` (Deno) stays
  as a documented reference-only copy — its own file comments already
  explain why it can't be the real thing.
- `deploy/site-worker-guild-a/deploy-pull.sh` — pulls this repo (sparse
  checkout of just this directory, shallow), diffs the tracked
  `index.js` against the live file, and if different, copies it in and
  restarts `guildcloud-worker.timer`.
- `guildcloud-worker-deploy.service`/`.timer` — systemd timer, every 2
  minutes, `OnBootSec=30s`.

**One-time setup performed directly on the LXC** (the last manual step
this mechanism will ever need): generated an ed25519 keypair locally on
the box (`ssh-keygen`, private key never left the container), added the
public half as a **read-only** GitHub deploy key
(`gh repo deploy-key add`, confirmed `read-only` in the listing), did the
initial sparse clone, installed and enabled the systemd units.

## Verified live, twice

1. **Manual trigger**: `systemctl start guildcloud-worker-deploy.service`
   → pulled real content, detected a (whitespace) diff against the live
   file, deployed it, restarted `guildcloud-worker.timer` cleanly —
   confirmed via `journalctl` on both units and a byte-for-byte `cmp`
   between the tracked and live files afterward (`FILES MATCH`).
2. **Unattended**: pushed a trivial comment-only change
   (`b181c45`), then waited without touching the container. The timer
   fired on its own schedule (`journalctl` shows the deploy service
   starting exactly 2 minutes after its previous run, matching
   `OnUnitActiveSec=2min` — no manual `systemctl start` in between), and
   `grep` on the live file confirmed the new comment landed for real.

## What this unblocks

Every future worker-side change in this plan (SSH key retroactive push,
device-enrollment sync) is now: edit `deploy/site-worker-guild-a/index.js`,
commit, push. No more manual pasting over a terminal, no more asking the
user to run commands on my behalf for a code change to take effect.
