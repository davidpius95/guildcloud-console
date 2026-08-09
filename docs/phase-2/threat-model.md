# Phase 2 — Threat Model

Same format as `docs/phase-1/threat-model.md`: what the threat is, the
mitigation, and how to verify the mitigation actually holds.

## 1. Site-worker network placement — found live, fixed, and verified this session

**What was built first, and why it was wrong:** the site worker
(`supabase/functions/site-worker-guild-a`) was built as a Supabase Edge
Function on a `pg_cron` schedule — confirmed with the user in advance as an
explicit MVP simplification. The first real end-to-end provisioning test
(not a smoke test — a real operation, real stages) failed at `preflight`:
Supabase Edge Functions run on Deno Deploy's infrastructure, with no route
into Guild-A's private LAN (`192.168.8.0/24`). No infrastructure
side-effect happened before this was caught.

**Fix, built and verified live:** the worker now runs as a plain Node.js
script (`/opt/guildcloud-worker/index.js`) on a dedicated LXC
(`vmid 500`, `guildcloud-site-worker-guild-a`, on `nodeD`, on Guild-A's own
network), driven by a systemd timer (`guildcloud-worker.timer`, every 20s,
`Type=oneshot` — one bounded stage per run, matching the original design).
Rejected alternative: exposing the Proxmox API via a public tunnel, which
would put a management-plane API on the internet for the first time — a
materially larger threat-model change than moving where a worker process
runs.

**A second, unrelated real bug found and fixed during this move:** the
Edge Function's `pg_cron` schedule was never unscheduled after the LXC
worker went live. For a window, **two independent pollers** (the
unreachable Edge Function and the new on-network worker) raced to claim
the same operation with no row-level locking between them, corrupting
`operation_stages`/`operations` state on a test run (a stage that had
already succeeded got overwritten with the Edge Function's own always-fails
network-timeout error). Fixed by `select cron.unschedule('site-worker-guild-a')`
— confirmed via `cron.job` that no schedule remains. **This is a real
argument for building actual row-level locking (`for update skip locked`)
before ever running more than one worker process against the same site**,
not just "don't forget to unschedule the old one" — noted as follow-up
work, not fully closed.

**Verified end-to-end, live:** created a real operation, watched it advance
through every stage against the real Proxmox API from the LXC, confirmed
the resulting VM `running` via `get_vm_status`, deleted it, confirmed
`nodeD`'s available RAM returned via `get_node_status`. Full detail in
`docs/dev-log/2026-08-09-phase2-e2e-proof-and-on-network-worker.md`.

## 2. Credential for the on-network worker — resolved: service-role key, with a stated trade-off

**The scoped-role attempt didn't survive real testing.** A dedicated
Postgres login role (`site_worker_guild_a`) was created with `GRANT`s
narrowed to exactly the tables it needs and RLS policies scoped to
`site_id = 'lag-1'` only — the least-privilege-first approach, matching the
Proxmox token's own design. Two real, separate blockers killed this path:
Supabase's connection pooler (Supavisor) doesn't recognize ad-hoc
SQL-created roles (`FATAL: tenant/user ... not found`, confirmed even after
a propagation wait), and the direct-connection path needs real IPv6 egress
— confirmed **absent** from the Guild-A LXC's own network (`ip a` shows
only a link-local `fe80::` address, no global IPv6; the sandbox used to
design this also lacked it, so this was genuinely unverified until tested
from the actual container).

**What shipped instead:** the worker's `SUPABASE_SERVICE_ROLE_KEY` is
stored in `/etc/guildcloud/worker.env` on the LXC (root-only, `chmod 600`,
never committed to git). This bypasses RLS entirely — a real, accepted
widening of blast radius versus the scoped-role design, justified by: (a)
the alternative (Supavisor/IPv6) is provably unavailable on this network
today, not just untested, and (b) the LXC itself is a single-purpose,
locked-down host with nothing else running on it. **This key was pasted
into this chat session's transcript during setup and must be treated as
compromised** — rotate it in the Supabase dashboard and update
`/etc/guildcloud/worker.env` with the new value; the worker script itself
needs no code change for a rotation.

**Follow-up worth doing, not done this pass:** revisit the scoped-role path
if/when a way to reach Supabase's pooler with a custom role is found, or if
IPv6 becomes available on this network — the service-role key is a stated
trade-off for now, not a permanent design decision.

## 3. Proxmox API token scoping (built and verified)

**Threat:** a compromised or overly-broad site-worker credential could
reach VMs/nodes/storage far beyond what provisioning on Guild-A actually
needs.

**Mitigation:** dedicated role `GuildCloudSiteWorker` (clone/config/
power-mgmt privileges only, no delete/migrate/HA), dedicated user
`siteworker-guild-a@pve`, dedicated pool `guildcloud-guild-a` scoping its
VM-creation privilege to guests it creates itself, `privsep=0` on its token
(inherits the user's exact grants directly, avoiding the token/user
intersection bug class hit twice this session for PBS — see
`docs/dev-log/`). ACLs: `/pool/guildcloud-guild-a`, `/storage/ceph-vm`,
`/nodes/nodeD` (all `propagate: true`), `/vms/9000` (the source template,
`propagate: false`, needed separately since it's outside the pool),
`/sdn/zones/localnetwork` (`propagate: true` — added after a real 403
during the live end-to-end test: `SDN.Use` is required for any clone that
attaches a network device, even to the plain bridge zone, not something
documented up front).

**Verification — both positive and negative, via direct `curl` with the
token exactly as the worker uses it, not through any MCP tool:**
- `GET nodes/nodeD/status` → 200, real data.
- `GET nodes/nodeA/status` (same token) → 403 `Permission check failed
  (/nodes/nodeA, Sys.Audit)`.
- `GET nodes/nodeD/qemu/130/status/current` (an existing unrelated guest,
  same token) → 403 `Permission check failed (/vms/130, VM.Audit)`.

The negative checks are what actually prove least-privilege — a token that
merely *can* do what it's supposed to, with no confirmation of what it
*can't* do, is an unverified claim.

## 4. Proxmox credential storage — Supabase Vault (built, unaffected by findings 1–2)

**Threat:** the Proxmox API token, if it ever leaked from wherever it's
stored, grants real infrastructure control (VM clone/power/config) on
Guild-A.

**Mitigation:** stored in Supabase Vault (`vault.create_secret`), read only
via `public.get_vault_secret(secret_name text)` — a `security definer`
wrapper (Vault isn't exposed via PostgREST directly), with `execute` revoked
from `public`/`anon`/`authenticated` and granted only to `service_role`
(Phase 2 finding #2 above extends this grant to `site_worker_guild_a` once
that credential path is finalized). Confirmed via
`information_schema.routine_privileges` that only `postgres`/`service_role`
(and now, pending finding #2, the scoped worker role) can read
`vault.secrets`/`vault.decrypted_secrets` at the table level.

**Stated trust boundary, not hidden:** wherever the worker process actually
runs now holds a live credential capable of real infrastructure changes on
Guild-A. This is inherent to having *any* automated site worker — the same
trust boundary existed in the Edge-Function design, just inside Supabase's
infrastructure instead of a Guild-A-resident process. What matters is that
it's the scoped token (finding #3), not a broader one, and that it's never
committed to git or displayed beyond what's needed to configure the
worker.

## 5. Capacity preflight uses live numbers, not a survey document

**Threat:** provisioning against a stale written capacity figure
(`docs/phase-0/capacity-model.md`) rather than live state could
over-commit a node that has since filled up, or under-commit one that's
freed capacity since the survey.

**Mitigation:** `preflight` always calls `GET nodes/{node}/status` live and
computes `available - held(unexpired) - requested` at the moment of the
check — the survey document is never read at request time, only used to
inform this design.

**Verification:** confirmed live at design time that `nodeD`'s real
available RAM (7.13 GB via `get_node_status`, re-confirmed at 7.04 GB
immediately before the real end-to-end test) differs from the Phase 0
survey's 8.26 GB figure — using the stale number would have been actively
wrong, not just imprecise.

## 6. `instances`/`operations` write authority

**Threat:** a customer directly manipulating `instances.state` or
`proxmox_vmid` client-side could desynchronize the console's displayed
state from real infrastructure, or claim an instance is `ready` before it
actually is.

**Mitigation:** `instances` has no client `update` RLS policy at all —
under RLS's default-deny model, absence of a policy is the denial. Only the
worker's own credential can transition state after the initial
`provisioning` insert. `ready` is only ever set by the worker's `ready`
stage handler, after `automated_verification` has actually run — matches
master plan §5's explicit requirement that nothing is Ready without a real
check.

**Verification:** confirmed live during the real end-to-end test —
`instances.state` transitioned `provisioning` → `ready` only via the
worker's own `ready` stage handler, only after `automated_verification`
(a real guest-agent ping) succeeded against the real cloned VM.

## 7. SSH key personalization and password SSH — built and verified this session

**Original threat:** the Guild-A template (`vmid 9000`) has a fixed
cloud-init `sshkeys` and `cipassword` baked in — one shared identity.
Cloning it as-is would mean every real instance boots with that same
shared key/password, not the customer's own — directly contradicting the
plan's per-customer-access model.

**Fix:** a real `ssh_keys` table (RLS: select via org membership, insert/
delete via Owner/Admin), a real Settings-page UI backing it (replacing a
previously dead mock section), and the worker now overrides
`sshkeys`/`cipassword` on every clone with the org's real keys before first
boot — confirmed live: `template_cloud_init` succeeded and the subsequent
`automated_verification` guest-agent ping succeeded against the real
cloned VM, meaning cloud-init actually applied the override correctly.

**Password SSH (opt-in, per master plan §10):** `instances.password_ssh_enabled`
threaded from the wizard's existing checkbox through to the worker. When
enabled, the worker generates a real password, stashes it in Vault under a
per-instance secret name, and a new `reveal_instance_ssh_password(uuid)`
function (internal Owner/Admin check, same pattern as `log_audit_event`'s
Phase 1 hardening) lets the console reveal it exactly once — the call
deletes the Vault secret as part of the same transaction, so a second call
always returns null. When not opted in, the worker still overwrites
`cipassword` with a discard-only random value nobody ever persists, so the
template's shared password never survives onto a real instance either way.

**Not built this pass, stated not hidden:** no rate-limiting on password
SSH attempts at the guest OS level (master plan §10 calls for this) —
that's a guest-side configuration concern, not something this worker
layer controls, and remains open.

## 8. `cicustom` vendor snippet (`tailscale-vendor.yaml`) — scope unreviewed

**Threat:** the template's `cicustom` field points at a vendor cloud-init
snippet that appears to auto-enroll every cloned VM into Tailscale at first
boot. If it uses a reusable, unscoped pre-auth key, every clone could land
on the tailnet with default (currently fully-open, per Phase 0 gap G-01)
ACL exposure automatically, with no per-customer control.

**Status:** not reviewed this session — found in passing while answering a
design question, not audited. **Should be reviewed before Phase 3 (private
access) is built on top of this template**, since it's plausible this
snippet is already doing informal work that Phase 3 is supposed to do
deliberately and per-customer.
