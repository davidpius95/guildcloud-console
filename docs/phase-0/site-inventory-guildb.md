# Phase 0 — Site Inventory: Guild-B

**Survey date:** 2026-08-08. Read-only, gathered via the same `ProxmoxMCP-Plus`
tool used for Guild-A — `pve_list_clusters` revealed a second configured
cluster (`guild-b`) that the original 2026-08-07 Phase 0 survey never queried.
User confirmed 2026-08-08: **Guild-B is intended to become GuildCloud's second
site**, not unrelated personal infrastructure (unlike `gean-devnet`, which
lives as a guest on this cluster but is explicitly out of scope — see below).

This document exists because the original Phase 0 survey (`site-inventory.md`)
implicitly claimed completeness while only covering one of two real clusters.
Treat this as a correction/addition to that survey, not a separate project.

## 1. How this was found

`ProxmoxMCP-Plus`'s `pve_call` tool description mentions multi-cluster support
("`cluster='guild-b'`") — nobody had checked whether a second cluster was
actually configured. It was, the whole time. The trigger for checking was
unrelated: while attempting to configure monitoring (gap G-12) via an Uptime
Kuma API key, the `/metrics` endpoint revealed monitor entries for hosts
(`guildA`/`guildC` at `192.168.8.199`/`192.168.8.102`) that didn't match any
known Guild-A node IP. Those turned out to be Guild-B's `podA` and `podC`.

## 2. Cluster identity

| Property | Value |
| --- | --- |
| Cluster name | `Guild-B` |
| Nodes | 5: `podA`, `podB`, `podC`, `podD`, `podE` |
| Quorum | Quorate (`quorate: 1`) as of survey time, with `podE` offline |
| Proxmox VE version | Not yet captured per-node (follow-up) |
| Physical location | **Same site as Guild-A** — same `192.168.8.0/24` subnet, same gateway `192.168.8.1` (the same Flint 2 router). Confirmed via `podA`'s network config. **This is not geographic redundancy** — a router, switch, or power failure at this location takes out both clusters simultaneously. |

## 3. Nodes

| Node | IP | Status | RAM total | RAM used | vCPU | Local disk |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| podA | 192.168.8.199 | online | 66.70 GB | 47.86 GB (71.7%) | 22 | ~93.9 GB |
| podB | 192.168.8.232 | online | 33.44 GB | 6.41 GB (19.2%) | 6 | ~93.9 GB |
| podC | 192.168.8.102 | online | 16.42 GB | 5.73 GB (34.9%) | 20 | ~93.9 GB |
| podD | 192.168.8.142 | online | 16.47 GB | 9.11 GB (55.3%) | 12 | ~93.9 GB |
| podE | 192.168.8.219 | **offline** | — | — | — | — |

**Total (excl. offline podE): ~133.03 GB RAM, 60 vCPU** — notably more raw
capacity than Guild-A's entire cluster (74.80 GB / 20 vCPU). podA alone
carries more RAM than all of Guild-A combined.

**No shared storage.** Every node uses `local-lvm` + local `dir` storage only
— no Ceph, no RBD, no cross-node storage redundancy. Losing a node's disk
loses that node's guests' data; nothing else on the cluster is a backup.

## 4. Guests

| VMID | Name | Node | Status | Notes |
| ---: | --- | --- | --- | --- |
| 100 | guildcloud-dev | podC | running | |
| 101 | uptime-kuma | podC (LXC) | running | **The Kuma host used for gap G-12 monitoring lives here** — it was never "external," it's a Guild-B guest. |
| 102 | test | podA | running | |
| 120 | k8s-cp-1 | podA | running | Kubernetes control plane |
| 121 | k8s-w-1 | podE | unknown (host offline) | |
| 122 | k8s-w-2 | podD | running | |
| 200 | homeassistant | podB | running | Previously seen as an unexplained Tailscale device — it's a Guild-B guest. Also the source of gap G-07 (advertises default routes, not yet approved). |
| 300 | gean-devnet | podA | running | Tags `ethereum;gean;lean-devnet`. **Confirmed out of scope** — this is the same pre-existing, non-GuildCloud workload the Tailscale ACL decision record (`docs/decisions/2026-08-07-tailscale-tenancy-model.md`) already named and deliberately left alone. |
| 400 | cloudstack-aio | podB | stopped | |
| 500 | fleetbase | podA | stopped | Previously an unexplained untagged Tailscale device — it's a Guild-B guest (stopped). |
| 9000 | ubuntu-2604-template | podA | template | |
| 9002 | guildct-template | podA | template | |

**A live Kubernetes cluster exists on Guild-B** (`k8s-cp-1` + `k8s-w-2`
running, `k8s-w-1` down with its host). This almost certainly serves the
public `*.guildserver.io` domains found in Kuma's monitor list
(`argocd`, `coolify`, `grafana`, `headlamp`, `jellyfin`, `rabbitmq`,
`requests`, `datacenter.guildserver.io`) — **all of which resolve to real
public IPs** (`72.251.7.22`/`72.251.7.23`), confirmed via DNS lookup. This
needs its own review — see gap G-21 below.

## 5. Network and security posture (mirrors Guild-A's original state)

- **No datacenter firewall rules** (`cluster/firewall/rules` → `[]`), same
  starting state Guild-A was in before G-05 was closed.
- **No backup jobs configured** (`cluster/backup` → `[]`), same starting
  state Guild-A was in before G-02 was closed. No PBS integration.
- SDN zone `evpn2` (EVPN, VXLAN VRF 10001, exit node `podA`) exists,
  mirroring Guild-A's `evpn1` — also unused by any guest, same as G-11.
- Same flat, untagged `192.168.8.0/24` network as Guild-A — no VLAN
  separation here either.

## 6. What this means for the gap register

New gaps filed (G-18 through G-21) and G-13 substantially revised — see
`gap-register.md`. Short version: a second cluster with real capacity
exists, but it doesn't give GuildCloud real site redundancy on its own
(same LAN, same power, same router), it has none of Guild-A's hardening
work applied yet (no firewall, no backups), and it's already carrying a
live public-facing workload that needs a security review before it can be
folded into any private-by-default story.

## 7. What this document does not cover

- Per-node Proxmox VE version, kernel, CPU model (not yet captured).
- Full guest-level detail (network config, resource limits) beyond what's
  shown above.
- The actual content/purpose of `guildcloud-dev` and `test` VMs — names
  suggest they may be relevant development infrastructure, not surveyed
  in depth here.
- Physical hardware inventory (unlike Guild-A's node-by-node CPU/model
  capture) — follow-up if Guild-B is formally adopted as the second site.
