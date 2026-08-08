# Dev log — 2026-08-08: G-11 SNAT fix attempted, not resolved

## What happened

Continued from the earlier G-11 finding (broken SNAT egress on Guild-A's
EVPN VNets). Investigated further rather than leaving it as an open
question.

## What was found

The Proxmox API's own field description for the SDN subnet `snat` option
reads *"enable masquerade for this subnet if pve-firewall"* — SNAT is
implemented via the Proxmox firewall service. Cross-referenced timing:
this SDN zone was surveyed as existing on 2026-08-07 (before this
session), and the Guild-A firewall wasn't enabled until earlier *today*
(G-05, this session). Checked the zone's live VRF routing table
(`nodes/nodeA/sdn/zones/evpn1/ip-vrf`) — it shows only the two connected
subnets, no default route out, consistent with the masquerade rule never
having been generated.

## What was tried

Confirmed no other pending SDN changes existed anywhere in the config
(zones, vnets, controllers, subnets — no `state: new/changed` markers).
Triggered a full SDN reload (`PUT /cluster/sdn`) to force regeneration of
the network config, including any firewall-dependent masquerade rules.
Verified afterward: task `OK`, all 5 nodes online and quorate, Ceph
`HEALTH_OK` — no side effects.

## What was verified — honestly, not assumed

Built a fresh throwaway test VM on `vnet50` (same disciplined pattern as
before: created, tested, destroyed, zero footprint) and re-ran the exact
same connectivity test. **Result: still 100% broken.** Gateway reachable,
site LAN gateway and public internet both 100% packet loss — identical
symptom to before the reload. The stale-config hypothesis is ruled out;
this was not the fix.

## Why this stops here

Per this project's own discipline: don't guess-and-poke at live
infrastructure without a diagnosable path forward. The next real step is
inspecting `nodeA`'s actual nftables/iptables rules and FRR routing state
directly on the host — something this session's toolset can't do
(QEMU guest-agent exec only reaches guest VMs, not the Proxmox host
itself; there's no generic host-shell tool available). Rather than keep
trying speculative API-level changes against a live, real network config,
stopped and documented the ruled-out hypothesis plus the actual next step
clearly.

## What changed

- Live: triggered one SDN reload (`PUT /cluster/sdn`) — verified benign,
  did not fix the issue.
- Live: one more throwaway test VM created and fully destroyed.
- `docs/decisions/2026-08-08-g11-sdn-validation.md` — updated with the
  full investigation, honestly reporting the negative result.
- `docs/phase-0/gap-register.md` — G-11 updated: fix attempted, not
  resolved, root cause still needs host-level access.

## Still open

SNAT egress remains broken. Needs either host shell access (SSH or
console) to inspect `nodeA` directly, or a different diagnostic path.
