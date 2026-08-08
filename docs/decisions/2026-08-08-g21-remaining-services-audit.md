# Decision record: G-21 — remaining Guild-B services audited

**Date:** 2026-08-08
**Status:** audit complete. One risk found and explicitly accepted by the
user (Portainer). No live changes made — this is a documented decision,
not a silent gap.

## Context

Follow-up to the Headlamp critical finding (`docs/decisions/2026-08-08-
g21-headlamp-cluster-admin-exposure.md`), which flagged that Guild-B's
other public services hadn't been checked for the same class of issue
(missing ingress auth + excessive ServiceAccount privilege).

## Method

Queried every non-`system:*` `ClusterRoleBinding` cluster-wide and every
`Ingress` object's annotations in one pass, via `kubectl` through the QEMU
guest agent into `k8s-cp-1`. Cross-referenced which services actually have
Kubernetes ingress objects at all (a wrong assumption in the original
audit request — corrected below).

## Finding 1: Portainer — cluster-admin, live on the current domain

- ClusterRoleBinding `portainer`: role `cluster-admin`, subject
  `portainer-sa-clusteradmin` (namespace `portainer`), label `owner:
  david` — a deliberate configuration, not an accidental Helm chart
  default (unlike Headlamp's binding).
- Ingress hosts: **`portainer.guildserver.io` AND
  `portainer.guild-technologies.com`** — live on the current, active
  domain, not just the expired one.
- No ingress-level auth annotation (no oauth2-proxy, no basic-auth) — the
  only gate is Portainer's own application login.

**Difference from Headlamp**: Portainer does have its own real
authentication (Headlamp's in-cluster mode had none at all). So this
isn't an open-door exposure — it's an architecture where a single web
app's login is the sole boundary between the public internet and full
cluster-admin. If that login is ever compromised (weak/reused password,
session hijack, a future Portainer CVE), the blast radius is total.

**Decision: accepted as-is by the user.** Explicitly asked whether to
downgrade (like Headlamp) or scope down to least-privilege; user chose to
leave it, understanding the tradeoff. Documenting this as the record of
that decision, not as an open, unaddressed gap.

## Finding 2: ArgoCD — very broad but standard for GitOps

ClusterRole `argocd-server`: `get/delete/patch` on `*` resources across
`*` API groups, cluster-wide. This is a common, largely unavoidable
pattern for GitOps controllers (they manage arbitrary manifests across
the whole cluster) — not flagged as a misconfiguration, just recorded as
a known broad-privilege surface. Has its own application login.

## Finding 3: Grafana — moderate, standard sidecar pattern

ClusterRole `kube-prometheus-stack-grafana-clusterrole`: read-only
`get/watch/list` on `configmaps` **and `secrets`**, cluster-wide — used
for Grafana's dashboard/datasource auto-discovery sidecar. Means Grafana's
own ServiceAccount can read every Secret in the cluster if Grafana itself
is compromised. Standard for this deployment pattern, not a
misconfiguration, but worth knowing: every credential ever stored as a
Kubernetes Secret in this cluster is technically within Grafana's read
reach.

## Correction to original audit scope

The original audit request assumed `coolify`, `jellyfin`, `rabbitmq`,
`requests`, and `datacenter`/PDM were Guild-B Kubernetes services, based
on their `guildserver.io`/`guild-technologies.com` domain names appearing
alongside the real k8s-hosted ones in Kuma's monitor list. **They are
not.** Only 6 real `Ingress` objects exist on Guild-B: `argocd`, `demo`
(hello), `headlamp`, `grafana`, `portainer`, `stateful` (persistent-web).

The other five domains almost certainly point to Guild-A's existing
legacy workloads (`coolify` = VM210, `jellyfin` = CT110, `rabbitmq` =
CT111, all already known from the original Phase 0 survey), reverse-
proxied separately — likely via Guild-A's own `ingress` container (CT910,
tagged "Ingress Caddy" in the site inventory). This is a **different
investigation** (application-level auth and default credentials, not
Kubernetes RBAC) — see the follow-up decision record for that work.

## What changed

- No live infrastructure was changed.
- User explicitly accepted the Portainer cluster-admin risk as a known,
  documented tradeoff rather than an unaddressed gap.
