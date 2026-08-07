# Dev log — 2026-08-07: G-05 datacenter firewall applied

## What happened

Picked up G-05 (no Proxmox datacenter firewall rules) next, per the gap
register's updated priority order. Re-read plan §6 first — confirmed the
Management/Tenant/Backup zone model is a network-topology design that
isn't buildable yet (flat single-subnet LAN, no VLANs, blocked on G-16's
unreachable Cisco switch), so scoped this to what firewall rules can
honestly achieve today: reducing lateral-movement risk on the existing
flat network, not implementing the full zone model.

Surveyed live state first: `cluster/firewall/rules` was `[]` and the
firewall subsystem itself was off at both datacenter and node level
(empty digest, no `enable` set anywhere) — a bigger gap than "no rules,"
the firewall had never been turned on.

## The real risk, and why the plan changed mid-flight

Proxmox's firewall applies to every interface, including Tailscale — the
only remote access path into this CGNAT'd site. Wrote an initial decision
record proposing a default-DROP-plus-allowlist rollout, but before
applying anything, checked the actual `nodes/{node}/firewall/options` API
schema and found it has no per-node `policy_in`/`policy_out` — that's
cluster-wide only. A default-DROP allowlist would have bet remote access
on getting every management flow right on the first try, cluster-wide, at
once.

Revised to a lower-risk design instead: keep the cluster-wide policy
explicitly ACCEPT (matches today's real behavior, zero implicit-deny
surface) and add one targeted DROP rule for the concrete risk the gap
register actually names — legacy workload guests (which have real
internet-facing attack surface: mediastack, coolify, jellyfin) reaching
Proxmox's own management ports (8006, 22).

## What was applied

1. IPSet `legacy-workloads` (7 guest IPs: mediastack, coolify,
   pdm-datacenter, jellyfin, rabbitmq, irc, ingress — `proxmox-mcp`
   excluded, it's GuildCloud's own tooling).
2. `cluster/firewall/options`: policy_in/out/forward = ACCEPT (explicit).
3. Per-node DROP rules (not DC-level, to avoid also filtering guest-to-guest
   traffic): `+legacy-workloads` → dport 8006 and 22, tcp.
4. Enabled node-by-node, verifying after each: nodeE first (no Ceph OSD,
   lowest blast radius) → nodeD → nodeC (checked Ceph health too) → nodeB
   (checked its own legacy guests, irc/rabbitmq, stayed running) → nodeA
   last (heaviest node, extra care taken there).
5. Enabled the cluster-wide master switch once nodeE's rule + per-node
   enable were confirmed in place, then re-verified immediately.

## Verification

All 5 nodes online and quorate after full rollout. Ceph `HEALTH_OK`, 65
PGs, no degradation. Every previously-running guest — including the
legacy workloads themselves — still `running`, unaffected.

## A real finding along the way, unrelated to this gap

While checking Tailscale reachability paths for this rollout, found nodeA
has silently lost its `tag:guildcloud-mgmt` tag (nodeB–E still have it).
Access is unaffected today only because of the pre-existing broad `src:*`
grant, but this is a real drift worth watching — same category as the
unexplained `podC` tag reversion noted in an earlier session. Logged in
the gap register under G-01, not fixed today (out of scope for this
change, and not urgent since access isn't actually broken).

## What changed

- `docs/decisions/2026-08-07-g05-firewall-proposal.md` — proposal, then
  updated in place with what was actually applied (the design changed
  after the initial write-up, before anything was touched live).
- `docs/phase-0/gap-register.md` — G-05 severity High → Medium; G-01
  annotated with the nodeA tag drift finding.
- Live change: Proxmox firewall enabled cluster-wide with the rules
  described above. This is the first live security-posture change beyond
  Tailscale ACL and backups.

## Still open

Full §6 zone-based firewall (Management/Tenant/Backup as actually
separated, enforced zones) remains blocked on G-16. The nodeA tag drift
needs re-tagging. Per the gap register, everything else (G-07–G-17) is
scheduled for Phase 1/2 planning and doesn't block control-plane work
(G-04).
