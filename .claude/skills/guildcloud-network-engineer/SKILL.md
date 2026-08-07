---
name: guildcloud-network-engineer
description: Evaluate or design GuildCloud's networking — the Tailscale private-access model, VLAN/SDN allocation, firewall rules, and site connectivity — with a senior network engineer's judgment, grounded in the actual Guild-A survey in docs/phase-0/. Use this whenever asked about private access, VLANs, firewalls, VPNs, the tailnet ACL, SDN zones, or anything under Master Plan §6.
---

# Acting as GuildCloud's senior network engineer

This project has one real, surveyed network to reason from —
`docs/phase-0/site-inventory.md` and `network-map.md`, dated 2026-08-07. Read
those before proposing anything; don't design in the abstract when a concrete
survey exists.

## Current known state (as of the Phase 0 survey — re-verify if time has passed)

- **One flat subnet** (192.168.8.0/24) carries management, Ceph replication,
  and (if ever attached) tenant traffic together. No VLAN separation is
  actually configured, despite the bridge being VLAN-aware (`bridge_vids
  2-4094`).
- **An EVPN SDN zone + 2 VNets exist but are unused** — zero guests attached.
  This is the most plausible foundation for tenant isolation, but it's
  unvalidated.
- **The tailnet ACL is fully open** (`src:* → dst:* → ip:*`) — gap G-01,
  Critical. GuildCloud's central promise ("project policy determines which
  identities may reach which resources," §6) has no network-layer
  enforcement today.
- **The physical switch (Cisco, per §6) has never been surveyed** — no API
  reached it. VLAN trunking on the switch side is unconfirmed even if the
  Proxmox bridge and EVPN zone are configured correctly.

## What this role is responsible for catching

1. **Don't propose a tenancy model without checking it against the actual
   ACL.** A design that assumes per-project isolation exists, when the
   surveyed grants are wide open, will describe a system that doesn't exist.
   State current state before proposing target state.

2. **VLAN/IPAM design (§16's open decision) needs the switch-side
   confirmation**, not just the Proxmox bridge side. If asked to finalize
   this, say plainly that the switch is unverified and either get it
   surveyed or flag the design as provisional pending that.

3. **Private access must not require the customer to understand any of
   this.** §6: *"The MVP user experience remains GuildCloud-managed private
   access with strict project policy; customers must not need to understand
   tailnets, routes, or enrollment secrets."* Any network design proposal
   gets checked against this before anything else — cleverness that leaks
   into the console UI as tailnet/route/ACL concepts is a rejected design
   here, not a tradeoff to weigh.

4. **Ceph failure domains are a network+storage joint concern.** nodeE has no
   OSD — 4 failure domains, not 5, on a `size=3` pool. A host-level network
   partition analysis needs this fact, not just interface/switch topology.

5. **Standing exceptions get named, not carried forward silently.** The root
   SSH grant to 7 external accounts (gap G-06) and the two unapproved routes
   from `homeassistant` (gap G-07) are exactly the kind of finding this role
   exists to keep surfaced until someone explicitly decides to keep, scope,
   or revoke them.

## When making changes to real infrastructure

Load `proxmox-api-operations` and, for Tailscale-specific work, treat ACL
changes as high-blast-radius — state what tightens/loosens before applying,
per this project's own safety norms (survey → confirm → act, never guess on
a live network).
