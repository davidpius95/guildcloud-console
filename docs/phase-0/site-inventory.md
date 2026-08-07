# Phase 0 — Site Inventory: Guild-A

**Survey date:** 2026-08-07
**Method:** Read-only Proxmox API (`guildcloud@pve`, PVEAuditor role) + Tailscale API.
No configuration was changed.
**Plan reference:** Master Plan §17 ("read-only infrastructure inventory for each
site: nodes, compute, storage, Proxmox versions, templates, switches,
router/VLANs, Tailscale state, backup targets, and monitoring"), Phase 0.

---

## 1. Cluster

| Property | Value |
| --- | --- |
| Cluster name | `Guild-A` |
| Proxmox VE version | 9.2.2 (release 9.2, repoid `b9984c6d90a4bd80`) |
| Ceph version | 20.2.2 "tentacle" (stable) |
| Nodes | 5 |
| Quorate | Yes (`quorate: 1`, config version 6) |
| Management subnet | 192.168.8.0/24 |

**Sites in existence: one.** The Master Plan's multi-site language (§6 zones,
Warm Standby in §3, "restore into a healthy site" in §8) has no second site to
resolve against yet. See gap register G-13.

---

## 2. Nodes

| Node | Mgmt IP | Cluster node ID | vCPU | RAM total | RAM used | RAM % | Root disk | Uptime | Ceph OSD |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| nodeA | 192.168.8.112 | 3 | 4 | 16.65 GB | 12.95 GB | **77.8%** | 73.7 GB | 3d 11h | osd.0 |
| nodeB | 192.168.8.155 | 5 | 4 | 16.65 GB | 5.94 GB | 35.7% | 72.7 GB | 3d 11h | osd.1 |
| nodeC | 192.168.8.156 | 4 | 4 | **8.21 GB** | 4.08 GB | 49.7% | 100.9 GB | 3d 11h | osd.2 |
| nodeD | 192.168.8.195 | 2 | 4 | 16.65 GB | 8.39 GB | 50.4% | 72.7 GB | 3d 11h | osd.3 |
| nodeE | 192.168.8.125 | 1 | 4 | 16.65 GB | 4.18 GB | 25.1% | 71.2 GB | 3d 8h | **none** |
| **Total** | | | **20** | **74.80 GB** | **35.54 GB** | **47.5%** | | | 4 OSDs |

All five nodes report `status: online`. CPU load is low across the board
(3.5%–12.1%); **memory, not CPU, is the binding constraint** on this cluster.

Two asymmetries worth recording:

- **nodeC has half the RAM** of the other four (8.21 GB vs 16.65 GB).
- **nodeE contributes no Ceph OSD** — it is a compute-only member of the storage
  cluster, so Ceph has four failure domains, not five.

### Hardware character

Disk inventory on nodeA shows a Samsung PM981 256 GB NVMe (the Ceph OSD, 97%
wear remaining, health PASSED) plus a Seagate ST500LT012 500 GB 5400 rpm 2.5"
HDD used only for BIOS boot. The node also exposes a `wlp58s0` wireless
interface. This is consumer/laptop-class mini-PC hardware, consistent with the
Master Plan's "measured mini-PC, storage, power, network, backup, and support
capacity" language in §16.

---

## 3. Storage

### 3.1 Configured storage pools

| Storage | Type | Shared | Content | Notes |
| --- | --- | --- | --- | --- |
| `ceph-vm` | rbd | **Yes** | rootdir, images | Primary guest storage |
| `local-lvm` | lvmthin | No | rootdir, images | Node-local, pins guests |
| `local` | dir | No | import, backup, iso, vztmpl | `/var/lib/vz` |

### 3.2 Ceph

| OSD | Host | Device class | Size | Used | Used % | PGs | Status |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| osd.0 | nodeA | ssd | 256.06 GB | 41.62 GB | 16.25% | 44 | up / in |
| osd.1 | nodeB | ssd | 250.06 GB | 44.30 GB | 17.72% | 50 | up / in |
| osd.2 | nodeC | ssd | 256.06 GB | 42.66 GB | 16.66% | 49 | up / in |
| osd.3 | nodeD | ssd | 250.06 GB | 41.29 GB | 16.51% | 51 | up / in |

**Raw capacity: 1,012,228,161,536 bytes ≈ 1.012 TB.** Distribution is even
(16.25%–17.72%), latency is low (apply 2–9 ms).

Pools:

| Pool | Size | Min size | PGs | Logical used | Raw used | Application |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `.mgr` | **2** | **2** | 1 | 7.08 MB | 14.17 MB | mgr |
| `ceph-vm` | 3 | 2 | 32 | 54.47 GB | 163.42 GB | rbd |
| `k8s-rbd` | 3 | 2 | 32 | 32 KB | 97 KB | rbd |

`.mgr` running `size=2, min_size=2` means losing a single replica halts writes to
that pool — see gap register G-09.

`k8s-rbd` exists and is essentially empty, implying a Kubernetes RBD integration
was prepared but is not yet carrying data.

---

## 4. Guests

16 guests total: 11 VMs and 5 LXC containers. 9 are running, 7 are stopped, and
3 of the stopped ones are templates.

### 4.1 Virtual machines

| VMID | Name | Node | Status | Memory (used / max) |
| ---: | --- | --- | --- | --- |
| 101 | netboot-pxe-test | nodeE | stopped | — / 2.15 GB |
| 108 | test-vm | nodeE | stopped | — / 2.15 GB |
| 220 | netboot-xyz | nodeE | running | 1.30 / 2.15 GB |
| 102 | paymenter | nodeC | stopped | — / 2.15 GB |
| 103 | ubuntu-vm-c | nodeC | stopped | — / 2.15 GB |
| 130 | mediastack | nodeA | running | 4.11 / 4.29 GB |
| 210 | coolify | nodeA | running | 3.95 / 4.29 GB |
| 200 | pdm-datacenter | nodeB | running | 1.49 / 4.29 GB |
| 300 | proxmox-mcp | nodeD | running | 4.42 / 4.29 GB |
| **9000** | **ubuntu-2604-guildvm-template** | nodeD | stopped | template |
| **9001** | **debian-13-guildvm-template** | nodeD | stopped | template |

### 4.2 Containers

| CTID | Name | Node | Status | Cores | Memory (used / max) |
| ---: | --- | --- | --- | ---: | --- |
| 111 | rabbitmq | nodeB | running | 2 | 0.13 / 2.15 GB |
| 911 | irc | nodeB | running | 2 | 0.09 / 2.15 GB |
| 110 | jellyfin | nodeA | running | 4 | 0.23 / 4.29 GB |
| 910 | ingress | nodeA | running | 2 | 0.08 / 1.07 GB |
| **9002** | **guildct-template** | nodeA | stopped | — | template |

**nodeA carries the heaviest load** — mediastack, coolify, jellyfin, ingress, and
the container template — which explains its 77.8% memory utilisation.

---

## 5. Templates and images

GuildCloud-named templates already exist from prior work:

| Artifact | Type | Location |
| --- | --- | --- |
| `ubuntu-2604-guildvm-template` (9000) | VM template | nodeD |
| `debian-13-guildvm-template` (9001) | VM template | nodeD |
| `guildct-template` (9002) | CT template | nodeA |
| `ubuntu-26.04-server-cloudimg-amd64.qcow2` | cloud image | `local:import` |
| `ubuntu-26.04-standard_26.04-1_amd64.tar.zst` | LXC template | `local:vztmpl` |

**Against the Master Plan's §7 catalogue** ("Ubuntu (recommended), Debian,
Fedora, Rocky Linux, and AlmaLinux"): Ubuntu and Debian exist; **Fedora, Rocky
Linux, and AlmaLinux do not** (gap G-10).

Note the OS versions are **Ubuntu 26.04 and Debian 13**, not the 24.04/12 pair
currently hard-coded in the console's mock data — the mock catalogue will need
correcting when it is wired to real data.

None of these templates yet has the §7-required version, owner,
security-update process, site synchronization procedure, private-access test, or
deprecation policy recorded.

---

## 6. Networking

### 6.1 Physical / bridge layer (nodeA representative)

| Interface | Type | Role |
| --- | --- | --- |
| `nic0` (`enp0s31f6`) | eth | Active uplink, member of `vmbr0` |
| `nic1` | eth | Present, `manual`, unused |
| `wlp58s0` | eth (wifi) | Present, `manual`, inactive |
| `vmbr0` | bridge | **192.168.8.112/24**, gateway **192.168.8.1**, VLAN-aware (`bridge_vids 2-4094`), STP off |

The bridge is VLAN-aware across the full 2–4094 range, but **no VLAN separation
is actually configured** — management, guests, and any future tenant traffic all
share the flat 192.168.8.0/24.

Gateway 192.168.8.1 corresponds to the **GL-MT6000** device seen on the tailnet —
this is the GL.iNet Flint 2 router named in Master Plan §6.

### 6.2 SDN

| Object | Type | Detail |
| --- | --- | --- |
| Zone `evpn1` | evpn | controller `evpnctl`, VRF VXLAN 10000, MTU 1450, exit node **nodeA**, IPAM `pve`, local routing enabled |
| VNet `vnet50` | vnet | tag 20050 |
| VNet `vnet60` | vnet | tag 20060 |

An EVPN fabric is configured and is the most plausible foundation for the
plan's tenant-isolation model — but **no guest in the inventory is attached to
either VNet**, so it is untested as a tenancy mechanism (gap G-11).

### 6.3 Firewall

`GET /cluster/firewall/rules` returns `[]`. **No datacenter firewall rules are
defined** (gap G-05).

---

## 7. Private access (Tailscale)

**Tailnet:** `tail345216.ts.net` — 27 devices registered.

### 7.1 Relevant devices

| Device | OS | Role | Last seen |
| --- | --- | --- | --- |
| `nodeA`–`nodeE` | linux | All 5 Proxmox nodes enrolled | 2026-08-07 |
| `GL-MT6000` | linux | Flint 2 router (gateway 192.168.8.1) | 2026-08-07 |
| `podA`–`podE` | linux | 5 additional hosts | 2026-08-07 |
| `proxmox-mcp` | linux | MCP server (VM 300) | 2026-08-07 |
| `homeassistant` | linux | **Advertises `0.0.0.0/0`, `192.168.8.0/24`, `::/0`** | 2026-08-07 |
| `kuma` | linux | Uptime Kuma — candidate monitoring | 2026-08-07 |
| `user's MacBook Pro` ×2, `David's S24 Ultra`, `DESKTOP-PL7IN7F` | mixed | Operator devices | recent |
| `guildct-template`, `guildct-template-1`, `ct-clone-test`, `ts-autojoin-test`, `ts-autojoin-ct-test`, `agent-watch-test` | linux | **Stale test/template registrations** | 2026-07-27 → 07-31 |

`homeassistant` advertises the LAN subnet and a default route, but its
`enabledRoutes` is **empty** — the routes are advertised and **not approved**, so
they are not in effect (gap G-07).

### 7.2 ACL policy — the critical finding

The tailnet policy contains:

```jsonc
"grants": [
  { "src": ["*", "autogroup:member"],
    "dst": ["*", "autogroup:admin", "autogroup:member"],
    "ip":  ["*", "tcp:*", "ipv4:*"] },
  { "src": ["*", "autogroup:member", "autogroup:shared", "autogroup:network-admin"],
    "dst": ["*", "autogroup:member", "autogroup:it-admin", "autogroup:owner"],
    "ip":  ["*", "tcp:*", "ipv4:*"] }
]
```

`src: *` → `dst: *` → `ip: *` is a **fully open tailnet**: every enrolled device
can reach every other device on every port. `acls` is `[]` and the only tag
defined is `tag:gean-devnet`.

This directly contradicts the plan's central promise in §6 — *"Project policy
determines which identities may reach which resources"* — and §3's private-access
boundary. There is presently **no tenancy model, no project isolation, and no
per-identity restriction** in the private-access layer (gap **G-01**).

Additionally, the `ssh` block grants **root SSH** into `tag:gean-devnet` hosts to
seven external Gmail accounts (`manbankat@`, `shaaibusuleiman9@`,
`itodosimonitodo1@`, `dimkayilrit@`, `kefasiceking@`, `nodebridgeafric@`,
`developerlongs@`). Whatever the intent, this is a standing external root grant
and must be reviewed (gap **G-08**).

---

## 8. Backups

| Check | Result |
| --- | --- |
| `GET /cluster/backup` (scheduled jobs) | `[]` — **none** |
| Backup volumes on `local` storage | none found (only `import` and `vztmpl` content) |
| Proxmox Backup Server | not configured as a storage target |
| Replication jobs (`GET /cluster/replication`) | `[]` — **none** |

**There is no backup of any kind on this cluster.** Master Plan §8 requires a
separate Proxmox Backup Server or equivalent, encrypted copies in at least two
locations, and a restore drill before any backup is considered valid. None of
that exists (gap **G-02**), and §3's Standard protection tier — "daily encrypted
off-site backup; seven-day retention" — is currently unbackable.

---

## 9. High availability

`GET /cluster/ha/resources` returns `[]`. **No HA resources are configured.** No
guest is set to restart or relocate automatically on node failure.

---

## 10. Access control (Proxmox)

| User | Realm | Role | Notes |
| --- | --- | --- | --- |
| `root@pam` | pam | full | `david@guildserver.io` |
| `guildcloud@pve` | pve | `PVEAuditor` on `/` (propagate) | "GuildCloud read-only inventory agent" — used for this survey |

Only two accounts exist. There is **no customer-facing role, group, pool, or
tenancy structure** in Proxmox — expected at this stage, but it means the control
plane's org/project model (Phase 1) has nothing to map onto yet.

---

## 11. Monitoring

No Proxmox-native monitoring integration was found. A host named `kuma`
(Uptime Kuma) is present and active on the tailnet, which is a plausible starting
point, but it is not wired to the cluster in any way this survey can verify
(gap G-12). The plan's §10 monitoring surface — site network/power/router/switch,
Proxmox cluster/node/storage, private access, backups, databases, Kubernetes,
functions, control plane, edge, billing, status — is essentially unbuilt.

---

## 12. What this inventory does not cover

Stated plainly so the gaps are not mistaken for clean results:

- **Switch configuration.** The Cisco switch named in Master Plan §6 is not
  reachable through the Proxmox or Tailscale APIs. Its port/VLAN configuration
  remains unverified and must be captured out-of-band.
- **Starlink / CGNAT behaviour.** Not directly observable here; the plan's claim
  that CGNAT prevents inbound access is untested by this survey.
- **Power, UPS, and physical environment.** No data source available via API.
- **Performance benchmarks.** This is a configuration and capacity survey, not a
  benchmark. §16 requires measured provisioning and recovery performance before
  any customer expectation is published — that work has not been done.
- **`podA`–`podE`.** Five hosts on the tailnet whose relationship to the cluster
  was not established. They are not Proxmox nodes.
