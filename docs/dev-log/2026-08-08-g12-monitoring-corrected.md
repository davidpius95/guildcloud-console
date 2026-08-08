# Dev log — 2026-08-08: G-12 corrected — monitoring exists, currently down

## What happened

Picked up remaining gap register items per the user's direction. G-12's
entry was written before Guild-B was discovered and was known to be
possibly stale, so checked it first rather than assuming it still held.

## What was found

A real, pre-existing monitoring stack on Guild-B's Kubernetes cluster —
`kube-prometheus-stack`, Loki, and custom `proxmox-exporter` deployments
for both Guild-A and Guild-B — built ~13 days before this session, found
by nobody until now. `uptime-kuma`'s "relationship to Guild-A" (the
original gap's open question) is resolved: it lives on Guild-B, separate
purpose, same platform.

Initially trusted `kubectl get pods` showing everything `Running` — caught
the problem by cross-checking `kubectl get nodes`, which showed `k8s-w-1`
(host: the still-offline `podE`) as `NotReady`. Confirmed live rather than
inferring from stale status: direct `curl` to Prometheus's own ClusterIP
returned connection-refused. The monitoring stack is genuinely down right
now — Prometheus and Grafana are both single-replica, both scheduled on
the down node, no anti-affinity.

## What was decided

Did not attempt to fix it. The user already asked to defer `podE` work
today; force-rescheduling the stuck pods risks a Longhorn PVC conflict if
`podE` comes back mid-fix, and isn't worth that risk to resolve a
monitoring gap the user hasn't asked to prioritize. Documented plainly
that this is a live, current consequence of that deferral, not a
theoretical follow-up — so the user has accurate information whenever
they do return to `podE`.

## What changed

- `docs/decisions/2026-08-08-g12-monitoring-corrected.md` — full record.
- `docs/phase-0/gap-register.md` — G-12 corrected with accurate current
  state: infrastructure exists, is currently non-functional, and even
  once healthy covers only the infra layer, not §10's full surface.
- No live infrastructure touched.

## Still open

G-12 stays Medium — real progress (accurate picture, not "unknown"
anymore) but not resolved. Will self-resolve once `podE` is addressed, or
could be fixed independently later with pod anti-affinity / multi-replica
config. Remaining register items after this: G-10 (template catalogue),
G-11 (unused SDN zones), G-17 (no benchmark).
