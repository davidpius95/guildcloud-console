# Decision record: G-18/G-19 — Guild-B firewall and backup wiring

**Date:** 2026-08-08
**Status:** G-19 complete and verified (podA-D; podE pending, offline).
G-18 mechanism proven — real backup completed successfully (`TASK OK`,
20 GiB VM 102 transferred, snapshot confirmed queryable in PBS under the
`guild-b` namespace, correct owner). Capacity risk for larger guests
flagged, not yet solved.

## Context

Following the same hardening already applied to Guild-A (G-05 firewall,
G-02 backups), the user asked for identical wiring on Guild-B — explicitly
without touching any of the running services (ArgoCD, Grafana, Portainer,
etc.) or the Headlamp RBAC fix already in place.

## G-19: Firewall

Mirrored the exact G-05 design: explicit `ACCEPT` cluster-wide policy (no
implicit default-deny, no lockout risk) plus a targeted `DROP` rule
blocking guest workloads from reaching Proxmox management ports.

1. Created IPSet `guildb-workloads` (5 IPs): `k8s-cp-1` (`.60`), `k8s-w-2`
   (`.62`), `uptime-kuma` (`.104`), `guildcloud-dev` (`.106`), the `test`/
   "GuildCloud instance" VM (`.66`). `gean-devnet` excluded — it uses DHCP
   so its IP isn't stable, and it's already explicitly out-of-scope
   per the existing Tailscale tenancy decision.
2. Set `cluster/firewall/options`: `policy_in`/`policy_out`/
   `policy_forward` = `ACCEPT`.
3. Added DROP rules (`+guildb-workloads` → `dport 22`/`8006`, tcp) to each
   node's own firewall — `podA`, `podB`, `podC`, `podD`. `podE` is
   currently offline (`No route to host`); its rules could not be
   submitted. **Follow-up needed**: add `podE`'s rules and enable its
   firewall once it's back online.
4. Enabled node-by-node, lowest-risk first: `podB` (only hosts
   `homeassistant`) → `podD` (k8s worker) → `podC` (hosts Kuma itself —
   verified Kuma stayed reachable via Tailscale after) → `podA` (highest
   stakes: k8s control plane, most guests). Verified reachability
   (`nodes/{node}/status`) and guest-agent responsiveness after each step
   before proceeding to the next.
5. Enabled the cluster-wide master switch. Re-verified `podB` immediately
   after, then all nodes again at the end (`cluster/status` → `quorate: 1`,
   all 4 online nodes reachable).
6. Final check: pulled Kuma's own `/metrics` and diffed for any newly-DOWN
   monitor. All 9 DOWN monitors were pre-existing (8 `*.guildserver.io`
   domains — confirmed expired by the user — and `k8s w-1`, whose host
   `podE` was already offline). Nothing new broke.

## G-18: Backups

Reused the existing Proxmox Backup Server (`guild-pbs`, already running on
Guild-A's `nodeE`) rather than provisioning a new VM, since it's reachable
on the same LAN (`192.168.8.126`).

### A real bug hit and fixed along the way

First attempt failed: `backup owner check failed
(backup@pbs!guild-b-cluster != backup@pbs!pve-cluster)`. Guild-A and
Guild-B assign VMIDs independently and their ranges overlap significantly
(both have 101, 102, 200, 300, 9000, and more) — Guild-A's node C already
has its own VM 102 (`paymenter`), and PBS's backup-group ownership model
ties a `vm/<vmid>` group in a datastore to whichever auth-id created it
first. Sharing one flat datastore across both clusters was the wrong
design; it would have silently failed (or worse, silently succeeded into
the wrong group) for every colliding VMID.

**Fix: PBS namespaces**, not a second datastore — same physical storage,
cleanly separated by source system. This PBS version (4.2.5) has no
`namespace` subcommand in `proxmox-backup-manager`; namespace creation is
API-only. Created one using a short-lived `root@pam` API token (granted
`Admin` on the datastore — even `root@pam`'s own tokens need explicit ACL
grants under PBS's privilege-separation model, same lesson as the original
PBS setup), called the local API once (`POST
.../admin/datastore/guild-a-standard/namespace name=guild-b`), verified
the namespace existed, then **deleted the temporary token immediately**
— matching §10's short-lived-credential principle rather than leaving a
superuser-scoped token lying around.

Updated Guild-B's `guild-pbs` storage config with `namespace=guild-b`,
retried — this time it worked, actively streaming data at proof time.

### What was configured

1. New PBS API token: `backup@pbs!guild-b-cluster`, granted
   `DatastoreBackup` + `DatastoreAudit` on `/datastore/guild-a-standard`
   (both the token and the underlying `backup@pbs` user, matching the
   privilege-separation requirement documented in the original PBS setup).
2. Guild-B storage registration: `guild-pbs`, type `pbs`, server
   `192.168.8.126`, datastore `guild-a-standard`, **namespace `guild-b`**.
   Verified `active: 1, enabled: 1` with real capacity numbers reported.
3. Backup job `guild-b-standard-daily`: daily at 02:00, all guests,
   7-day retention, snapshot mode, zstd compression — same shape as
   Guild-A's `guild-a-standard-daily`.
4. Proof backup triggered manually against the lowest-risk guest (`test`
   VM, 20 GB disk) to confirm the pipeline actually works end-to-end, not
   just that the job exists in config. **Result: `TASK OK`.** 20 GiB
   transferred in 121s (169.3 MiB/s, 82% sparse/reused), "Backup job
   finished successfully." Independently confirmed by querying PBS's own
   snapshot list for the `guild-b` namespace: one snapshot,
   `vm/102/2026-08-08...`, 21,474,837,542 bytes, owner
   `backup@pbs!guild-b-cluster` — matches expectations exactly, not just
   trusting the task's own exit status.

### Known capacity risk — flagged, not solved

The PBS host has only ~75 GB free (`df` on `/`: 99G total, 20G used, 75G
avail). Several Guild-B guests are far larger than anything on Guild-A —
`gean-devnet` alone has a 1 TB disk allocated. **The daily
`guild-b-standard-daily` job backing up "all" guests will very likely fail
from disk exhaustion** once it reaches the larger guests, even though the
namespace/ownership issue is now fixed. This needs a real capacity
decision (expand the PBS datastore, exclude the largest guests from the
all-guest job, or both) before the job can be trusted to actually
complete — not solved today, flagged here so it isn't missed.

## What changed

- Live change: Guild-B firewall enabled cluster-wide (4 of 5 nodes; `podE`
  pending) with the rules described above.
- Live change: new PBS token `backup@pbs!guild-b-cluster`, ACL grants, new
  namespace `guild-b` on the `guild-a-standard` datastore, new storage
  registration on Guild-B, new backup job `guild-b-standard-daily`.
- Temporary root token created and deleted within the same session — no
  standing credential left behind.
