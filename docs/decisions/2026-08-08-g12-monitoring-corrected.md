# Decision record: G-12 corrected — monitoring exists but is currently down

**Date:** 2026-08-08
**Status:** finding documented. No live change made — the fix (rescheduling
Prometheus/Grafana off the down node, or waiting for `podE`) is deliberately
not applied, since the user has already asked to defer `podE` work.

## What was found

The original gap register entry for G-12 (written 2026-08-07, before
Guild-B was discovered) said monitoring was entirely unwired and Kuma's
relationship to Guild-A was unconfirmed. Investigating Guild-B's
Kubernetes cluster today (already underway for other reasons) surfaced a
real, pre-existing monitoring stack that predates this session by ~13
days:

- `kube-prometheus-stack`: Prometheus, Grafana, `kube-state-metrics`,
  node-exporters on every k8s node.
- Loki + promtail (log aggregation) on every node.
- Two custom `proxmox-exporter` deployments, explicitly labeled
  `pve_cluster=guild-a` and `pve_cluster=guild-b` — someone already built
  Proxmox-layer metrics collection for both clusters.
- `uptime-kuma` (the host named in the original G-12 text) lives on this
  same Guild-B cluster (`podC`), a separate, simpler uptime/ping monitor.

## What was verified, not assumed

`kubectl get pods` initially showed everything `Running`, including pods
on node `k8s-w-1`. Cross-checked against `kubectl get nodes`: `k8s-w-1` is
actually `NotReady` — it lives on `podE`, which is still offline (per the
user's own deferral from earlier today). The `Running` pod statuses were
stale cached state from before the node went down, not current truth.

Confirmed live rather than trusting metadata: `curl` directly to
Prometheus's own ClusterIP (`10.100.129.188:9090/-/healthy`) returned
`code=000` — connection refused. Prometheus is genuinely unreachable right
now.

## Why this matters beyond "one gap corrected"

Prometheus and Grafana are both single-replica with no pod anti-affinity,
both scheduled on the same node. When that node went down (as part of the
already-known `podE` outage), the entire monitoring stack went down with
it — the system meant to catch failures has no resilience against the
exact kind of failure it exists to monitor. This is a live, ongoing
consequence of the `podE` deferral, not a separate hypothetical problem.

## Why no fix was applied today

The user explicitly asked to leave `podE` alone for now ("for now I will
come back to podE later"). Forcing a fix here — evicting and
rescheduling the stuck pods onto `k8s-w-2` or `k8s-cp-1` — carries real
risk: Prometheus's data (and likely Grafana's) sits on a Longhorn-backed
PVC. Force-deleting a pod stuck on an unreachable node while its volume
might still be attached there, especially if `podE` comes back mid-fix,
risks a split-brain write conflict on that volume. That risk isn't worth
taking to fix a monitoring gap when the user already chose to defer
`podE`-related work. This is flagged for whenever `podE` itself is
addressed, not treated as a separate urgent fix.

## What this monitoring stack does and doesn't cover

Even once healthy, it covers the Proxmox/node/log layer for both
clusters — real and useful, but only a fraction of what §10 requires:
private-access health, backup job success/failure, databases, functions,
control plane, edge, billing, and a status page are all still unbuilt,
since none of that exists before Phase 1's control plane.

## What changed

- `docs/phase-0/gap-register.md` — G-12 corrected with the full accurate
  picture: infrastructure exists, is currently non-functional, and covers
  a narrower scope than §10 ultimately requires.
- No live infrastructure was touched.
