# Decision record: G-11 — SDN tenancy mechanism validated (two real gaps found)

**Date:** 2026-08-08
**Status:** validated with real testing, not just config review. Two
concrete technical gaps found, neither fixed today — both need their own
scoped work, documented here so they aren't lost.

## Context

Gap register G-11: an EVPN SDN zone and two VNets exist on Guild-A but
"zero guests use them — the tenancy mechanism is unvalidated." Rather than
just re-reading the config (already done in the original Phase 0 survey),
actually tested it: attached real guests to the VNets and exercised the
paths the plan's tenancy model depends on.

## Existing config (unchanged, just verified)

- Zone `evpn1`: EVPN, VRF-VXLAN 10000, exit node `nodeA`,
  `exitnodes-local-routing: 1`, BGP-EVPN controller peering all 5 nodes
  (ASN 65000).
- `vnet50` → subnet `10.50.0.0/24`, gateway `.1`, `snat: 1`.
- `vnet60` → subnet `10.60.0.0/24`, gateway `.1`, `snat: 1`.

## Test method

Cloned two throwaway VMs from the existing Ubuntu template (`sdn-test-
vnet50`, `sdn-test-vnet60`; VMIDs 9998/9999, 512MB/1 core each — minimal
footprint, placed on `nodeE` which had headroom, not on `nodeA` which is
tight on RAM). Attached one to each VNet with static cloud-init IPs
matching each subnet. Booted, confirmed correct IP assignment via guest
agent, ran real connectivity tests via `agent/exec`, then destroyed both
VMs immediately after — no persistent footprint left behind.

## Finding 1: intra-zone routing works

Both test guests reached their own gateway (`10.50.0.1` / `10.60.0.1`)
cleanly, and each reached `nodeA`'s own LAN IP (`192.168.8.112`) directly.
The VXLAN overlay and EVPN routing to the exit node function correctly.

## Finding 2: external SNAT egress is broken

Despite `snat: 1` configured on both subnets, neither test guest could
reach the real site LAN gateway (`192.168.8.1`) or the public internet
(`1.1.1.1`) — 100% packet loss on both, from both VNets. Traffic reaches
the exit node (`nodeA`) but never gets NAT'd out to the physical network.
This predates today's G-05 firewall work — that change used an explicit
`ACCEPT` default policy, not a restriction, and the failure pattern
(reaches the exit node, dies at the LAN boundary) points at a missing or
inactive masquerade rule on `nodeA`, not a firewall block. Root cause not
diagnosed further — this needs node-level netfilter/FRR inspection tooling
this session doesn't have, not a guess-and-poke fix.

## Finding 3: the two VNets are not isolated from each other

A guest on `vnet50` (`10.50.0.10`) successfully reached a guest on
`vnet60` (`10.60.0.10`) directly, and the reverse worked too (`ttl=63`,
one hop — consistent with routing through the shared zone, not a fluke).
This is expected Proxmox SDN behavior, not a bug: `vnet50` and `vnet60`
share one zone (one VRF), and `exitnodes-local-routing: 1` explicitly
enables routing between VNets in the same zone via the exit node. VNets
are L2 segments within a zone's L3 domain — they are not tenant isolation
boundaries. **True per-tenant isolation requires a separate zone (VRF)
per tenant, not just a new VNet in the shared zone.** This is a real
architectural finding for whenever Phase 3 tenant networking gets
designed: the current two-VNet setup is a connectivity demo, not a
tenancy model, and shouldn't be mistaken for one.

## What this means for G-11 and beyond

The gap register's original framing — "the tenancy mechanism is
unvalidated" — undersold it. It's now validated, and validation surfaced
two real problems: a broken egress path, and a VNet structure that
doesn't provide the isolation a "tenancy mechanism" implies. Neither is
fixed today. Both are legitimate scoped follow-ups:

- **SNAT/masquerade fix**: needs direct investigation on `nodeA` (iptables/
  nftables masquerade rules, FRR route redistribution) — tooling this
  session doesn't have.
- **Isolation architecture decision**: whether Phase 3's tenant model uses
  one zone per tenant (clean isolation, more SDN objects to manage) or
  some other mechanism (e.g., firewall rules between VNets in a shared
  zone) needs a real design decision, not an assumption that today's
  two-VNet setup already provides it.

## What changed

- No live infrastructure was changed. Two throwaway VMs were created,
  tested, and fully destroyed — zero net footprint.
- `docs/phase-0/gap-register.md` — G-11 updated with real validation
  results instead of "unvalidated."
