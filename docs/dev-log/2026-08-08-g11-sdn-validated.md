# Dev log — 2026-08-08: G-11 actually validated — 2 real gaps found

## What happened

Continued the gap register work. G-11 said the SDN tenancy mechanism was
configured but unvalidated. Rather than just re-confirming the config
exists (already known), actually tested it with real guests.

## Method

Cloned two minimal throwaway VMs (512MB/1 core) from the existing Ubuntu
template, one attached to `vnet50` (10.50.0.0/24), one to `vnet60`
(10.60.0.0/24), placed on `nodeE` (had headroom — `nodeA`, the EVPN exit
node, is tight on RAM but doesn't need to host the test guests). Verified
correct IP assignment via cloud-init, then ran real connectivity tests via
QEMU guest-agent exec: gateway reachability, external egress (SNAT to
1.1.1.1 and the real site LAN gateway), and cross-VNet reachability
(testing whether the two VNets are actually isolated from each other).
Destroyed both VMs immediately after — zero persistent footprint.

## What was found

1. Intra-zone routing genuinely works — both guests reached their gateway
   and the exit node cleanly.
2. **External SNAT egress is broken.** Despite `snat:1` on both subnets,
   traffic reaches the exit node but never gets NAT'd out to the real
   LAN/internet. Checked whether today's G-05 firewall change might be
   the cause — ruled it out, since that used an explicit ACCEPT default,
   and the failure pattern (dies exactly at the LAN boundary, not
   earlier) points at a missing/inactive masquerade rule on the exit
   node, not a firewall block. Root cause needs node-level netfilter
   tooling this session doesn't have — flagged, not fixed.
3. **The two VNets are not isolated from each other** — a guest on one
   reached a guest on the other directly, both directions. This is
   expected Proxmox SDN behavior (VNets share one zone/VRF, and the zone
   has `exitnodes-local-routing` enabled), not a misconfiguration — but
   it means the current setup doesn't provide tenant isolation. A real
   tenancy model needs one zone per tenant, which is a design decision
   for Phase 3, not something today's setup already gives for free.

## Why this matters

The original gap's framing ("unvalidated") undersold what was actually
wrong. Validating it didn't just check a box — it surfaced a real,
concrete infrastructure bug (broken egress) and a real architectural gap
(no actual isolation) that would have been discovered the hard way during
Phase 3 otherwise.

## What changed

- `docs/decisions/2026-08-08-g11-sdn-validation.md` — full record.
- `docs/phase-0/gap-register.md` — G-11 updated with real findings.
- No live infrastructure changed — test VMs created, tested, and fully
  destroyed within this session.

## Still open in the register

G-17 (no performance benchmark run) is the last item from the "work
remaining gap register items" direction.
