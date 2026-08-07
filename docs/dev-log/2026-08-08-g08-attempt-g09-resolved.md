# Dev log — 2026-08-08: G-08 attempted (blocked), G-09 resolved

## G-08: stale Tailscale device cleanup — attempted, blocked

Re-confirmed the 6 stale devices from the gap register were still enrolled
and still stale (idle since 2026-07-27–07-31). Got explicit approval to
remove all 6, then attempted `device_action(delete)` for each.

All 6 calls were refused by the MCP tool permission layer itself:
`"Tool requires admin risk level"` — not a Tailscale API error, a
permission gate on the tool. Re-checked the live device list afterward;
all 6 are still present, nothing was touched.

This needs either manual removal via the Tailscale admin console, or this
session's Tailscale MCP connection granted admin-level device permissions
before it can be done from here. Logged in the gap register as an attempt,
not a resolution.

## G-09: Ceph `.mgr` pool redundancy — resolved

`.mgr` pool ran `size=2, min_size=2` while both other pools on the same
4-OSD cluster (`ceph-vm`, `k8s-rbd`) already ran `size=3` — proving 3x
replication is safe capacity-wise here. `.mgr` was the outlier, and a tiny
one (14 MB).

Checked Ceph health before (`HEALTH_OK`, 65 PGs) and applied `size=3` via
`PUT nodes/nodeA/ceph/pool/.mgr`. Polled the resulting async task to
`exitstatus: OK`, then verified the pool's live config (`size: 3`
confirmed, not inferred from the task result) and re-checked cluster
health after (`HEALTH_OK`, 65 PGs, no degraded/misplaced objects).

## What changed

- `docs/phase-0/gap-register.md` — G-08 noted as attempted/blocked; G-09
  marked resolved.
- Live change: Ceph `.mgr` pool `size` 2 → 3 (`min_size` unchanged at 2).

## Still open

G-08 needs manual device removal or elevated tool permissions. Remaining
register items (G-07, G-10 through G-17 except G-13/G-16 which are
genuinely blocked without a second site / physical switch access) are
still open, Medium/Low severity, none blocking.
