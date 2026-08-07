# Phase 0 — Gap Register: Guild-A

**Survey date:** 2026-08-07. Every gap below was observed directly against the
live cluster (see `site-inventory.md` for the underlying evidence) and checked
against a specific Master Plan commitment. Severity reflects blast radius if
GuildCloud launched on this infrastructure exactly as found today.

| ID | Gap | Plan reference | Evidence | Severity |
| --- | --- | --- | --- | --- |
| **G-01** | Tailscale ACL is fully open (`src:* → dst:* → ip:*`); no per-project or per-identity restriction exists | §6 "Project policy determines which identities may reach which resources"; §3 boundary "no public VPS IP or public SSH" | `manage_acl` → `grants` block, `acls: []` | **Critical** |
| **G-02** | No backups exist — zero scheduled jobs, no PBS target, no replication | §8 entire section; §3 Standard tier "daily encrypted off-site backup" | `cluster/backup` → `[]`; `cluster/replication` → `[]` | **Critical** |
| **G-03** | No HA resources configured — a node failure does not restart or relocate any guest | §8 recovery language; implicit in "restore into a healthy site" | `cluster/ha/resources` → `[]` | **High** |
| **G-04** | No control-plane, API, auth, or data model exists — every console screen is mock data with no persistence | §13 Phase 1 (Control plane foundation) | `grep` for API routes/DB/auth deps in the console repo: none found | **High** (expected at this stage, but blocks everything downstream) |
| **G-05** | No datacenter firewall rules defined | §6 private-access boundary | `cluster/firewall/rules` → `[]` | **High** |
| **G-06** | Standing root SSH grant to 7 external Gmail accounts on `tag:gean-devnet` hosts | §10 "no automatic support access... any exceptional access is customer-approved, time-limited, audited, revocable" | ACL `ssh` block, third entry | **High** — needs an explicit decision, not a silent carry-forward |
| **G-07** | `homeassistant` advertises `0.0.0.0/0`, `::/0`, and the LAN subnet as exit-node routes | §6 zone model — nothing should offer a default route into tenant traffic | Tailscale device list, `advertisedRoutes` | Medium (routes are advertised but **not** approved — `enabledRoutes` is empty, so not yet in effect) |
| **G-08** | Six stale test/template Tailscale registrations remain enrolled (`guildct-template`, `guildct-template-1`, `ct-clone-test`, `ts-autojoin-test`, `ts-autojoin-ct-test`, `agent-watch-test`) | Housekeeping; widens G-01's exposed surface | Tailscale device list, last seen 2026-07-27 to 07-31 | Medium |
| **G-09** | Ceph `.mgr` pool runs `size=2, min_size=2` — losing one replica halts writes to that pool | §8 "keep encrypted copies across at least two locations" implies redundancy margin, not a single-fault-tolerant floor | `ceph_df` pool listing | Medium (small pool, but a real single point of failure) |
| **G-10** | OS template catalogue has Ubuntu 26.04 and Debian 13 only; Fedora, Rocky Linux, AlmaLinux from §7's catalogue are absent | §7 "Ubuntu (recommended), Debian, Fedora, Rocky Linux, and AlmaLinux" | Storage content + guest list | Medium |
| **G-11** | EVPN SDN zone and two VNets are configured but zero guests use them — the tenancy mechanism is unvalidated | §16 "Tailscale tenancy model must be validated"; also the VLAN/IPAM half of that same decision | `sdn_list_zones` / `sdn_list_vnets` vs. guest network config | Medium |
| **G-12** | No monitoring is wired to the cluster; an Uptime Kuma host exists on the tailnet but its relationship to Guild-A is unconfirmed | §10 Monitoring and alerts | No Proxmox-side integration found; `kuma` device present but unverified | Medium |
| **G-13** | Only one site exists — every plan reference to multi-site (Warm Standby, "restore into a healthy site," §6 zones) has no second site to target | §3 Warm Standby tier; §8 restore | `pve_list_clusters` / inventory — single cluster | Medium (expected pre-launch, but blocks Warm Standby entirely) |
| **G-14** | Non-GuildCloud workloads (mediastack, coolify, jellyfin, rabbitmq, irc, pdm-datacenter, ingress, proxmox-mcp) occupy real capacity on the same nodes with no stated policy on whether they stay, move, or get counted against customer capacity | §11 "plans and quotas are derived from measured real capacity" — this can't be answered until this is decided | Guest inventory cross-referenced against capacity model | High — blocks any real capacity number |
| **G-15** | nodeC has half the RAM of every other node (8.21 GB vs 16.65 GB); nodeE contributes no Ceph OSD | §16 "measured mini-PC... capacity" | Node inventory | Low-Medium — a placement/scheduling input, not a blocker |
| **G-16** | Physical switch (Cisco, per §6) was not reachable through any available API — its VLAN/port configuration is unverified | §6 physical site model; §16 network design prerequisite | Not observable via Proxmox or Tailscale APIs | Medium — blocks finishing G-11's VLAN design |
| **G-17** | No performance benchmark has been run; all capacity numbers in `capacity-model.md` are configuration-time, not load-tested | §16 "measured provisioning and recovery performance on actual sites before any customer expectation is stated" | Explicit scope note in capacity-model.md | Medium |

## Immediate next actions this register implies

In the order the Master Plan's own §17 lists them:

1. **Close G-01 before anything else.** A private-by-default product running on
   a fully-open network is a false promise today, not a future one.
2. **Decide G-06** explicitly — keep, scope down, or revoke the external root
   SSH grant — rather than let it carry forward silently.
3. **Stand up backups (G-02) and HA (G-03)** before any customer data exists on
   this cluster, not after.
4. **Resolve G-14** (what happens to the pre-existing workloads) — every later
   capacity and pricing number depends on this answer.
5. Everything else in this register can be scheduled into Phase 1/2 planning
   normally; none of it blocks starting the control-plane work in G-04.
