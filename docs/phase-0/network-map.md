# Phase 0 — Network Map: Guild-A

**Survey date:** 2026-08-07. Read-only. See `site-inventory.md` for full command
output this is derived from.

```
Internet
   │
   ▼
[ Flint 2 router — GL-MT6000 ]   192.168.8.1  (also a tailnet device)
   │  LAN: 192.168.8.0/24, flat, no VLAN separation observed
   │
   ▼
[ Cisco switch — NOT surveyed, unreachable via API ]
   │
   ├── nodeA  192.168.8.112  ── vmbr0 (VLAN-aware, untagged) ── nic0 ── uplink
   ├── nodeB  192.168.8.155  ── (same pattern, not individually re-verified)
   ├── nodeC  192.168.8.156
   ├── nodeD  192.168.8.195
   └── nodeE  192.168.8.125

Ceph (RBD, shared storage plane, carried over the same 192.168.8.0/24 —
no dedicated storage/replication network was found)
   nodeA(osd.0) ── nodeB(osd.1) ── nodeC(osd.2) ── nodeD(osd.3)
   nodeE: compute-only, no OSD

SDN overlay (configured, unused by any guest)
   zone evpn1 (EVPN, VXLAN VRF 10000, exit-node nodeA, MTU 1450)
     ├── vnet50 (tag 20050)
     └── vnet60 (tag 20060)

Tailscale overlay (tailnet: tail345216.ts.net, 27 devices)
   All 5 Proxmox nodes + GL-MT6000 + 5 "pod" hosts + proxmox-mcp +
   kuma + homeassistant + operator devices, ALL under one flat,
   fully-open ACL (src:* -> dst:* -> ip:*)
```

## Layers, as they exist today vs. as the plan requires

| Layer | Plan's zone model (§6) | What actually exists |
| --- | --- | --- |
| Management | Never customer reachable | Same flat LAN as everything else; only isolation is "nobody's built a customer path yet" |
| Tenant | Project-isolated instance/service networks | EVPN zone + 2 VNets exist but **no guest uses them** — zero isolation in practice |
| Backup | Never customer reachable | No backup traffic exists at all — see gap G-02 |
| Edge (future) | Outbound tunnel only, no public exposure | Not built; out of scope for MVP per plan |

## Single points of failure visible from this map

1. **One router.** The Flint 2 (GL-MT6000) is the only gateway. No redundant
   uplink was observed.
2. **One switch**, unverified, sitting between the router and every node.
3. **One subnet.** Management, Ceph replication, and (if ever attached) tenant
   traffic all share 192.168.8.0/24 — a saturated or compromised segment affects
   everything simultaneously.
4. **nodeE has no Ceph OSD.** Losing nodeA, B, C, or D each removes 25% of Ceph
   capacity; the cluster has exactly 4 storage failure domains, not 5.

## Immediate network decision this map exposes

The plan's own §16 already flags "final private address/VLAN allocation" as
needing "the live Flint 2, Cisco switch, Proxmox bridge, and site constraints."
This map confirms the Proxmox bridge side is a flat network with an EVPN overlay
sitting unused next to it — the VLAN/IPAM design work in §16 has a real overlay
to build on, but the switch-side VLAN trunking that would carry tagged tenant
traffic to it has not been confirmed and needs physical/console access to the
Cisco switch, which this survey could not reach.
