# Dev log — 2026-08-08: Guild-B discovered (second real cluster)

## What happened

Was working G-12 (monitoring). Attempted to use a Kuma API key the user
provided (two attempts — first two keys failed as Basic Auth username,
third attempt with the key as the Basic Auth *password* against
`/metrics` worked). The metrics revealed monitors for hosts that matched
no known Guild-A node IP.

Investigated instead of ignoring the anomaly: `pve_list_clusters` showed
the `ProxmoxMCP-Plus` tool has a second cluster configured, `guild-b`,
that the original Phase 0 survey (2026-08-07) never queried — it only
ever called the tool against the default `guild-a` cluster, and nobody
had checked whether more were configured.

## What was found

A real, live, quorate 5-node Proxmox cluster (`podA`–`podE`) with more
raw capacity than Guild-A's entire cluster, sharing Guild-A's exact LAN
and gateway. It hosts several previously-unexplained Tailscale devices —
including the Kuma monitoring host itself — a live Kubernetes cluster,
and real public-facing HTTPS domains (`*.guildserver.io`) resolving to
public IPs.

This directly contradicted gap G-13 ("only one site exists"), which every
decision since 2026-08-07 had treated as settled fact.

## What was decided

Stopped and asked the user rather than assuming either direction. User
confirmed: Guild-B is intended to become GuildCloud's second site (not
out-of-scope personal infra like `gean-devnet`, which still lives on it
but stays excluded per the existing Tailscale decision).

## What changed

- `docs/phase-0/site-inventory-guildb.md` — new full survey, mirroring
  the structure of the original Guild-A survey.
- `docs/phase-0/gap-register.md` — G-13 revised (not closed — Guild-B
  solves "no second cluster" but not "no geographically separate site").
  Four new gaps filed: G-18 (no backups), G-19 (no firewall), G-20 (same-
  LAN, no real DR value yet), G-21 (live public-facing exposure, unreviewed).
- `docs/decisions/2026-08-08-guildb-discovery.md` — decision record.
- No live infrastructure was touched. The G-02/G-05-style fixes this
  cluster obviously needs (backups, firewall) are deliberately not
  applied yet — G-21's scope question needs an answer first, and a
  firewall change here could affect already-live public services.

## Still open

G-12 (monitoring) itself is still unresolved — the checklist approach was
paused mid-investigation by this discovery. G-18/G-19/G-21 all need their
own proposal-and-sign-off cycle, same pattern as G-02/G-05 on Guild-A.
