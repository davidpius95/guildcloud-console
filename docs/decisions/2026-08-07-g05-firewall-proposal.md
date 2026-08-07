# Decision (proposed): G-05 — datacenter firewall rules for Guild-A

**Date:** 2026-08-07
**Status:** accepted and applied. See "What was actually applied" below —
the final design differs from the original proposal in this document
(safer: explicit ACCEPT default + one targeted DENY, not an allowlist
under default-DROP), refined after surveying the real risk more precisely.

## Context

`cluster/firewall/rules` returns `[]`, and firewall is not enabled at
either the datacenter or node level (`cluster/firewall/options` and
`nodes/*/firewall/options` both return an empty digest with no `enable`
key set) — confirmed live today. This is a bigger gap than "no rules
defined": the firewall subsystem itself has never been turned on.

Plan reference (§6): zone model requires Management and Backup to be
"never customer reachable," Tenant to be "only allowed project users and
workloads." §3: "No public VPS IP or public SSH in the MVP."

## Why this is lower-leverage than it looks, today

`docs/phase-0/network-map.md` already found: Guild-A is a **flat
192.168.8.0/24 LAN**, no VLAN separation, and the EVPN tenant overlay
exists but zero guests use it. The zone model in §6 is a network-topology
design that isn't built yet — that's tracked separately as G-11 (SDN
zones unused) and G-16 (Cisco switch unreachable, blocking the VLAN work
§16 calls for). A datacenter firewall can filter by IP/port right now, but
it cannot enforce "zone" separation on a network that has no zones yet.

So this proposal is scoped to what firewall rules can honestly achieve
today — reducing lateral-movement and management-surface exposure on the
existing flat network — not to implementing the full §6 zone model, which
needs G-16 resolved first.

## Real risk this proposal must manage

Proxmox's firewall applies to **every interface, including Tailscale's**.
Guild-A is CGNAT'd with no inbound public path — the only remote access
this session (or the user, working remotely) has is via Tailscale. A
default-deny policy applied before the right allow-rules exist would cut
off that access with no network-based way back in; recovery would require
physical console access to the site.

This is exactly the kind of hard-to-reverse, high-blast-radius action this
project's working discipline requires sign-off for before applying — not
"continue" as blanket authorization, a specific yes on this specific
staged plan.

## Proposed rules (datacenter level, before any policy change)

Add explicit ACCEPT rules first, while leaving the top-level input policy
at its current default (effectively open, matching today's real behavior)
so nothing changes access until rules are verified:

| Rule | Source | Dest port/service | Why |
| --- | --- | --- | --- |
| Allow mgmt web UI | `tag:guildcloud-mgmt` + `tag:operator` (Tailscale IP ranges already scoped by the ACL work) | tcp/8006 | Proxmox web GUI — already the only tagged group with reachability per the Tailscale decision |
| Allow SSH to nodes | `tag:guildcloud-mgmt` + `tag:operator` | tcp/22 | Matches existing SSH grant scope (G-06) |
| Allow Ceph cluster/OSD | nodeA/B/C/D (192.168.8.112/155/156/195) | tcp/3300,6789,6800-7300 | Required for Ceph to function between the 4 OSD nodes — must not be blocked by accident |
| Allow Corosync | all 5 nodes | udp/5405-5412 | Cluster membership — blocking this partitions the cluster |
| Deny mgmt ports from legacy workload guests | mediastack/coolify/jellyfin/etc. VM/CT source IPs | tcp/8006, tcp/22 to node IPs | The actual lateral-movement risk this gap register worries about — user-facing apps with real attack surface reaching Proxmox management |

## Staged rollout (only after explicit sign-off)

1. Add the ACCEPT rules above at the datacenter level. Do **not** enable
   the firewall or change default policy yet.
2. Enable the firewall on **one node only** (propose nodeE — no Ceph OSD
   role, lowest blast radius if something breaks) with default policy
   still permissive, and verify Tailscale SSH + web GUI access is
   unaffected.
3. Only after step 2 is confirmed working, enable on the remaining nodes
   one at a time, re-verifying access after each.
4. Add the explicit deny rule for legacy-workload-to-management traffic
   last, once the allow-list is proven not to break anything.

## What was actually applied (2026-08-07, after sign-off)

The rollout above was revised before applying, once the exact Proxmox
firewall option shape was checked: `nodes/{node}/firewall/options` has no
per-node `policy_in`/`policy_out` — that policy is cluster-wide only
(`cluster/firewall/options`). So the original "allowlist under default-DROP"
design was dropped in favor of a lower-risk one: **keep the cluster-wide
policy explicitly ACCEPT (matches today's real behavior) and add one
targeted DENY rule** for the actual lateral-movement risk this gap cares
about, rather than betting remote access on an allowlist being complete on
the first try.

1. Created IPSet `legacy-workloads` (datacenter level) with the 7 legacy
   guest IPs: mediastack `192.168.8.246`, coolify `192.168.8.30`,
   pdm-datacenter `192.168.8.247`, jellyfin `192.168.8.244`, rabbitmq
   `192.168.8.245`, irc `192.168.8.11`, ingress `192.168.8.10`.
   `proxmox-mcp` excluded — it's GuildCloud's own tooling and needs
   management-port access to function.
2. Set `cluster/firewall/options`: `policy_in=ACCEPT`, `policy_out=ACCEPT`,
   `policy_forward=ACCEPT` — explicit, matches current real permissive
   behavior. No implicit default-DROP anywhere in this design.
3. Added two DROP rules to **each node's own firewall** (not the DC-level
   ruleset, to avoid also filtering guest-to-guest VM traffic): source
   `+legacy-workloads`, `dport 8006` (web UI/API) and `dport 22` (SSH),
   `proto tcp`, `log info`.
4. Enabled node-level firewall (`enable=1`) one node at a time — nodeE
   first (no Ceph OSD role, lowest blast radius), then nodeD, nodeC, nodeB,
   nodeA — verifying `get_node_status` (and Ceph health after nodeC) after
   each before proceeding to the next.
5. Enabled the cluster-wide master switch (`cluster/firewall/options
   enable=1`) after nodeE's rule + node-enable were in place, then
   re-verified nodeE reachability immediately.

**Verification after full rollout:** all 5 nodes online and quorate
(`get_cluster_status`), Ceph `HEALTH_OK` with all 65 PGs, all previously-
running guests (including the legacy workloads themselves — irc, rabbitmq,
mediastack, coolify, pdm-datacenter — and `proxmox-mcp`/`guild-pbs`) still
`running` and unaffected. `cluster/firewall/rules` (DC level) correctly
shows `[]`, since the DENY rules live at node level by design, not DC
level.

**Known pre-existing issue, not caused by this change:** nodeA's Tailscale
device has no `tag:guildcloud-mgmt` tag (nodeB–E do) — noticed while
surveying reachability paths for this work. Access to nodeA is currently
preserved by the tailnet's pre-existing broad `src:["*"]` grant, so this
firewall rollout is unaffected by it, but it's a real drift from the
intended tagging state and should be fixed as its own follow-up (see gap
register — not filed as a new gap ID here, flagged for the next session).

## What this decision record does not do

It does not implement the full §6 zone model (blocked on G-16, the Cisco
switch). It does not change the cluster's default posture from permissive
to restrictive — that would require the VLAN/zone foundation this gap
register already tracks as separately blocked.
