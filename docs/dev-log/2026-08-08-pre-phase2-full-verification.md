# Dev log — 2026-08-08: full cross-phase verification before Phase 2

## What was asked

Before starting Phase 2, test everything built in prior phases — not
re-read docs and assume, actually re-check live state.

## Console / Phase 1 (control plane)

- `npx tsc --noEmit` — clean.
- `npm run build` — clean, all 30 routes present.
- Browser-verified every real-data page (landing, sign-up, sign-in,
  console dashboard, projects, project detail, settings, audit log) with
  fresh, unbuffered tabs and `read_console_messages`.
- **Found and fixed two real bugs**, both confirmed against a real
  production build (`next start`, not just dev mode), not just dev-mode
  symptoms:
  1. A benign, expected hydration warning from the theme-flash-prevention
     script on every page — fixed with `suppressHydrationWarning` on
     `<html>` (the standard fix for this exact pattern).
  2. A real hydration-mismatch bug (React error #418 in production):
     `toLocaleDateString()`/`toLocaleString()` with no explicit locale
     resolve differently server vs. client (confirmed directly: Node gives
     `"8/8/2026, 3:25:35 PM"`, an en-GB browser gives `"08/08/2026,
     15:25:35"` for the identical Date). Fixed with pinned-locale
     `formatDate`/`formatDateTime` helpers, applied everywhere a
     server-fetched timestamp is rendered.
- Mobile width (375px): no horizontal overflow on the previously-broken
  settings page.
- Dark-mode toggle: not wired to a click handler. Pre-existing, not part
  of anything built this session — noted, not fixed.

## Guild-A infrastructure

- Cluster: quorate, all 5 nodes online.
- Ceph: `HEALTH_OK`, 4/4 OSDs up/in, 65 PGs, no degraded/misplaced.
- Firewall: enabled on all 5 nodes; G-05 DROP rules (block legacy
  workloads from ports 8006/22) confirmed present on nodeA.
- Templates: all 5 (Ubuntu 26.04, Debian 13, Fedora 43, Rocky 10.2,
  AlmaLinux 10.2) + the LXC template still present and correctly tagged.
- SDN: `evpn1` zone still configured as documented (SNAT/isolation gaps
  from G-11 not re-tested this pass — already thoroughly investigated
  and documented as open, re-testing wouldn't add new information without
  the host-level access this session still doesn't have).
- **Real regression found**: PBS backup prune permission failure
  (`missing Datastore.Modify|Datastore.Prune`) recurring live, on a fresh
  test run — the fix documented earlier today (`docs/decisions/
  2026-08-08-backup-prune-permission-fix.md`) is not durably in effect.
  Full detail and next steps in `docs/dev-log/
  2026-08-08-backup-prune-regression-found.md`. Backup **data transfer**
  itself remains reliable on both clusters — only retention/pruning is
  affected.

## Guild-B infrastructure

- Cluster: quorate, 4/5 nodes online (podE still offline, per the
  standing user-deferred decision — not a new issue).
- Firewall: enabled on all 4 online nodes; G-19 DROP rules confirmed
  present on podA.
- Storage: healthy (guild-pbs 12% used, local-lvm 4%, local 6%).
- Backup: **not regressed** — 2 fresh live test runs (one QEMU VM, one
  LXC container, matching the exact guest type that failed on Guild-A)
  both completed cleanly, and the job's own recent history shows only
  successful runs since the original fix (the two "job errors" entries in
  its history both predate the fix).
- k8s monitoring stack: confirmed still down (Prometheus and Grafana both
  return connection-refused on direct ClusterIP health check) — this
  matches the already-documented G-12 finding exactly (blocked on
  `k8s-w-1`, which lives on the still-offline podE). Not a new problem,
  not improved, not worse.

## Tooling notes worth remembering

- The dedicated Proxmox convenience tools (`vzdump`, `execute_vm_command`,
  `get_task_log`) don't support the `cluster` parameter and silently
  default to (or time out trying to reach) Guild-A. `pve_call` with an
  explicit `cluster` argument is the reliable way to reach Guild-B.
- `execute_vm_command` against the Guild-A PBS VM (400) returned
  `success: true, exit_code: 0` but empty output for every command,
  including trivial ones — confirmed broken for that VM this session, not
  a permissions issue. The manual `agent/exec` + `agent/exec-status`
  two-step via `pve_call` worked correctly on Guild-B's k8s-cp-1, so this
  is specific to that VM/path, not a universal tool failure.
- A full-cluster `vzdump --all` reproduction attempt was correctly blocked
  by the session's safety guardrail as a broader-blast-radius production
  action — did not attempt to route around it; used narrower single-guest
  tests instead, which were sufficient to reach a confident conclusion.

## Bottom line

Phase 1 is solid — real bugs were found by testing, not assumed away, and
fixed with verified production-build evidence. Guild-B infrastructure is
holding up well against everything re-tested. Guild-A has one real,
current regression (PBS prune permissions) that needs someone with direct
PBS access to re-diagnose and fix properly — I don't have tooling to
reach PBS's own ACL system this session. Recommend fixing that before
Phase 2, since Phase 2 adds real customer-facing provisioning on top of
Guild-A, and backup retention is a stated product commitment (§8).
