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
`ACCEPT` default policy, not a restriction.

**Follow-up investigation (same day, later session):** the Proxmox API's
own field description for the subnet `snat` option reads *"enable
masquerade for this subnet if pve-firewall"* — meaning SNAT is
implemented via the Proxmox firewall service. This zone was built
2026-08-07, before any node had its firewall enabled (G-05 turned it on
for Guild-A only on 2026-08-08, later the same day as this investigation).
Hypothesis: the masquerade rule is generated when SDN config is applied,
and was never regenerated after the firewall came on.

**Tested and ruled out**: confirmed no other pending SDN changes existed
(zones/vnets/controllers all clean, no `state: new/changed` markers),
then triggered a full SDN reload (`PUT /cluster/sdn`) — completed `OK`,
cluster stayed quorate, Ceph stayed `HEALTH_OK`, all 5 nodes reachable
afterward. Re-tested with a fresh throwaway VM on `vnet50`: **SNAT egress
is still 100% broken** — identical symptom, gateway reachable, LAN and
internet both 100% packet loss. The reload was not the fix. Test VM
destroyed immediately after, confirmed via a clean guest-list read.

**Honest status**: root cause is not diagnosed. The "stale config from
before the firewall was enabled" hypothesis is ruled out. What remains is
genuinely inspecting `nodeA`'s live netfilter/nftables rules and FRR
routing state to see whether the masquerade rule exists at all, is
present but not matching, or something else entirely is wrong (e.g. a
route leak from the VRF to the default table is missing — the VRF's own
routing table, checked via `nodes/nodeA/sdn/zones/evpn1/ip-vrf`, shows
only the two connected subnets and no default route out, which is
consistent with either explanation). This needs host shell access this
session doesn't have — guest-agent exec only reaches guest VMs, not the
Proxmox host itself. Flagged as a real, still-open technical gap, not
guessed at further.

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
