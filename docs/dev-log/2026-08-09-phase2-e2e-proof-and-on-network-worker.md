# Dev log — 2026-08-09: real Phase 2 end-to-end proof, on-network worker, SSH key/password features

## Where this picks up

The previous session's dev-log
(`2026-08-08-phase2-durable-operations-and-worker-reachability-gap.md`)
ended blocked: the site worker (built as a Supabase Edge Function) had a
real, confirmed reachability gap — it cannot reach Guild-A's private LAN at
all, discovered via the first real end-to-end test. This session resolved
that, ran the real end-to-end proof to completion, and added two
customer-facing features that a design question surfaced as missing.

## Moving the worker on-network

User chose (over a public tunnel): move the worker onto Guild-A's own
network rather than expose the Proxmox API to the internet. Built:

- A dedicated LXC (`vmid 500`, `guildcloud-site-worker-guild-a`, on
  `nodeD`).
- A dedicated least-privilege Postgres role (`site_worker_guild_a`) scoped
  via RLS to `site_id='lag-1'` — the "correct" credential design,
  attempted first.
- **Real blocker found testing the credential, not assumed working:**
  Supabase's connection pooler doesn't recognize ad-hoc SQL-created roles
  (`tenant/user ... not found`), and the direct-connection path needs IPv6
  — confirmed **absent** on this network by running `ip a` from inside the
  actual LXC once we could reach it (only a link-local address, no global
  IPv6). Fell back to the Supabase service-role key, stored root-only in
  `/etc/guildcloud/worker.env`, with the trade-off stated explicitly in
  `docs/phase-2/threat-model.md` rather than silently accepted.
- **A real tooling blocker, resolved by the user, not routed around:** no
  available tool could exec into the new LXC (SSH disabled in the Proxmox
  MCP server's config, console fallback timed out on trivial commands).
  User did the actual terminal work directly (`pct enter 500`), with
  guidance given turn-by-turn since the assistant had no live view into
  the terminal beyond a read-only panel reader.
- **A credential handled carelessly by the user, flagged immediately:** a
  root password and the Supabase service-role key both ended up pasted
  directly into the chat during setup. Both flagged as compromised the
  moment they appeared; the service-role key rotation is now a tracked,
  overdue operator-runbook item.
- The worker itself: `/opt/guildcloud-worker/index.js`, a straight
  Node.js port of the Deno Edge Function (global `fetch`, `@supabase/
  supabase-js` from npm, `NODE_TLS_REJECT_UNAUTHORIZED=0` for Guild-A's
  self-signed cert), run via a systemd timer (`guildcloud-worker.timer`,
  `OnUnitActiveSec=20s`).
- **A real DNS bug found immediately**: the fresh LXC's `/etc/resolv.conf`
  pointed at Tailscale's MagicDNS resolver (`100.100.100.100`), inherited
  from the host node's own config, but Tailscale wasn't installed in the
  container — so nothing could resolve. Fixed by pointing it at real
  public resolvers (1.1.1.1/8.8.8.8).

## The real end-to-end test — three real bugs found live

Created a genuine `instances`/`operations`/`operation_stages` row set
(same shape `createInstance` produces) and watched the on-network worker
process it.

1. **`preflight` succeeded on the first real attempt** — real Proxmox data
   (`available_gb: 7.17`), the first successful real Proxmox call this
   entire phase.
2. **A real concurrency bug**, found because it corrupted state on this
   exact test run: the *old* Edge Function's `pg_cron` schedule had never
   been unscheduled after the on-network worker went live. Two independent
   pollers, no row-level locking, raced on the same operation — the
   already-`done` `preflight` row got overwritten with the Edge Function's
   own always-fails network-timeout error. Fixed with
   `cron.unschedule('site-worker-guild-a')`. Confirmed via `get_vms` that
   no orphan VM existed from the race (the failures were both pre-clone).
3. **`proxmox_api_call` failed**: `parameter 'storage' not allowed for
   linked clones` — the earlier "speed fix" (`full: 0` for Ceph RBD
   copy-on-write cloning) is incompatible with also specifying a target
   `storage`, which is only valid for full clones. Fixed by dropping the
   parameter for linked clones; deployed to both the container script (via
   the user running a `sed` patch) and the Deno source (kept in sync).
4. **`proxmox_api_call` failed again, differently**: `403 Permission
   check failed (/sdn/zones/localnetwork/vmbr0, SDN.Use)`. Any clone that
   attaches a network device needs `SDN.Use`, even on the plain default
   bridge zone — not documented anywhere obvious, found only by the real
   403. Fixed by adding `SDN.Use` to the `GuildCloudSiteWorker` role and
   granting an ACL scoped to just `/sdn/zones/localnetwork` (not all SDN
   zones).
5. **Full success after both fixes**: a real VM (`vmid 703839`, named
   `e2e-proof-2`) cloned, booted, verified `running` via `get_vm_status`
   (1 vCPU / 2GB, matching the `std-1` plan), guest-agent ping succeeded,
   `automated_verification` passed, operation reached `succeeded`,
   instance reached `ready`.
6. **Resume proven for real, not staged**: across the two failure/fix
   cycles above, `preflight` through `site_worker_dispatch` were never
   redone — every retry correctly resumed from the actual failing stage.
7. **Cleanup**: deleted the real VM, confirmed via a fresh `get_node_status`
   that `nodeD`'s available RAM returned (~7.67GB, consistent with the
   pre-test baseline), deleted the test `instances`/`operations` rows.

## Two features added mid-session, from a design question

User asked whether cloud-init drives on-the-fly provisioning and whether
it can happen in milliseconds — answering honestly (checked the real
template config live) surfaced two real gaps worth fixing immediately
rather than filing away:

1. **SSH key personalization.** The template's `sshkeys` was one fixed,
   shared key — every clone would have inherited it verbatim. Built: a
   real `ssh_keys` table (RLS-scoped to org), wired the Settings page's
   previously-dead mock "SSH keys" card to it for real, and the worker now
   overrides `sshkeys` per clone with the org's actual keys. Verified live:
   `template_cloud_init` succeeded and the subsequent guest-agent ping
   succeeded on the real cloned VM — proof the override actually took
   effect in cloud-init, not just that the API call didn't error.
2. **Opt-in password SSH**, per master plan §10. Wired the wizard's
   existing (previously decorative) checkbox through
   `instances.password_ssh_enabled` to the worker, which generates a real
   password only when opted in, stashes it in Vault under a per-instance
   secret, and a new `reveal_instance_ssh_password` RPC (internal
   Owner/Admin check, same pattern as `log_audit_event`'s Phase 1
   hardening) lets the console reveal it exactly once — the call deletes
   the Vault secret as part of revealing it. When not opted in, the
   worker still overwrites the template's shared password with a
   discard-only random value, so it's never inherited either way.
3. Also fixed in passing: `full: 1` → `full: 0` (linked/copy-on-write
   clone via Ceph RBD) for a real, meaningful provisioning-speed
   improvement — this is what surfaced bug #3 above.

## What's still explicitly open, not silently accepted

- Rotate the Supabase service-role key (pasted into chat during setup —
  compromised by policy, not because it's actually been misused).
- The scoped-Postgres-role credential path for the worker never got to
  ship — service-role key is a stated trade-off, revisit if Supavisor or
  IPv6 constraints change.
- No real row-level locking (`for update skip locked`) between potential
  concurrent worker processes — got away with it here because the second
  poller is now fully disabled, but the underlying design gap (relying on
  "only one poller running" as an informal invariant) is real.
- The `cicustom` Tailscale vendor snippet's own scope was never actually
  reviewed this session either — still open from the prior dev-log.
- Guest-OS-level rate limiting for password SSH (master plan §10) isn't
  something this worker layer controls — still open.

## Verify-green

`npx tsc --noEmit` and `npm run build` both clean after all of the above
(schema changes, worker script changes, new console features).
