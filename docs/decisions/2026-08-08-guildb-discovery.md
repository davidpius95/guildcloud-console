# Decision record: Guild-B discovered as a second real cluster

**Date:** 2026-08-08
**Status:** finding documented, no infrastructure changed. Follow-up work
(G-18/G-19/G-21) needs its own sign-off before anything is touched.

## What happened

While working gap G-12 (monitoring), investigating an Uptime Kuma API key
led to discovering monitor entries for hosts (`guildA`/`guildC` at
`192.168.8.199`/`192.168.8.102`) that matched no known Guild-A node. Cross-
checking against `ProxmoxMCP-Plus`'s `pve_list_clusters` revealed a second
configured cluster, `guild-b`, that the original 2026-08-07 Phase 0 survey
never queried — it only ever called the tool against the default `guild-a`
cluster.

Full survey: `docs/phase-0/site-inventory-guildb.md`.

## What Guild-B actually is

A real, quorate, 5-node Proxmox cluster (`podA`–`podE`, `podE` currently
offline) with ~133 GB RAM and 60 vCPU total — more raw capacity than
Guild-A's entire cluster. No shared storage (local-lvm per node only, no
Ceph). Runs a live Kubernetes cluster, several previously-unexplained
Tailscale devices (`homeassistant`, `fleetbase`, and the Kuma host itself),
and the already-known-and-deliberately-excluded `gean-devnet` workload.

**Confirmed with the user:** Guild-B is intended to become GuildCloud's
second site, not out-of-scope personal infrastructure (unlike `gean-devnet`
specifically, which stays excluded per the existing Tailscale decision).

## Why this isn't simply "G-13 resolved"

Guild-B shares Guild-A's exact LAN and gateway (`192.168.8.1`). Same
router, same physical site, presumably same power. It does not provide
geographic redundancy — a site-wide outage takes out both clusters at
once. The plan's Warm Standby tier requires a genuinely separate location.
So G-13 is revised, not closed: the "no second cluster" problem is solved,
the "no geographically separate site" problem is not.

## New gaps filed

- **G-18**: no backups on Guild-B (mirrors G-02's original state).
- **G-19**: no firewall on Guild-B (mirrors G-05's original state), rated
  higher urgency than G-05 was, because Guild-B already has real public
  exposure (G-21) making the stakes of an unprotected management surface
  higher.
- **G-20**: Guild-B's lack of geographic separation, tracked as its own
  gap so it doesn't get silently forgotten once G-13 reads as "resolved."
- **G-21**: Guild-B serves real public-facing HTTPS domains
  (`*.guildserver.io`, resolving to public IPs `72.251.7.22`/`.23`) via
  what's almost certainly its Kubernetes cluster. This directly conflicts
  with the plan's "no public VPS IP or public SSH" MVP boundary if any of
  this is meant to eventually sit under GuildCloud. Not yet security
  reviewed. Scope unclear — needs an explicit answer, not an assumption,
  before further action.

## What this decision record does not do

It does not apply the G-02/G-05-style fixes (backups, firewall) to
Guild-B. Given G-21 is still an open scope question — and a firewall
change could plausibly affect reachability of the public services
already running there — those fixes need their own proposal and sign-off,
the same way G-02 and G-05 did for Guild-A, not a blanket extension of
"continue."

## What changed

- `docs/phase-0/site-inventory-guildb.md` — new survey document.
- `docs/phase-0/gap-register.md` — G-13 revised; G-18–G-21 filed.
- No live infrastructure was touched.
