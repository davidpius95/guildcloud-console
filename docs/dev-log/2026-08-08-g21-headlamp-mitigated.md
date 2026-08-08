# Dev log — 2026-08-08: G-21 investigated, critical Headlamp finding mitigated

## What happened

Started investigating G-21 (Guild-B's unreviewed public exposure) as
agreed. Couldn't verify public reachability directly — every outbound
attempt from this session's sandbox timed out (general egress
restriction, not evidence either way about real-world reachability).

Pivoted to direct inspection instead: used the QEMU guest agent (already
proven reliable earlier this session on Guild-A) to exec `kubectl` inside
`k8s-cp-1` (VM 120, `podA`, Guild-B). This is a legitimate, sophisticated
platform — ArgoCD, Kyverno, Velero, Longhorn, MetalLB, Cilium/Hubble, and
a full Prometheus/Grafana/Loki stack **already monitoring both Guild-A and
Guild-B** via dedicated `proxmox-exporter` deployments labeled per
cluster. Relevant to G-12 too — monitoring may substantially already
exist here, same pattern as the G-13 site discovery.

## Critical finding

`headlamp.guildserver.io`/`.guild-technologies.com` (a full Kubernetes
dashboard) had no ingress-level authentication of any kind, and ran in
Headlamp's `-in-cluster` mode — meaning it authenticates to the k8s API
using its own ServiceAccount, not the visitor's identity. That
ServiceAccount was bound to `cluster-admin`. If reachable, this is a full,
unauthenticated cluster takeover — no login required.

Stopped immediately and reported this to the user rather than continuing
routine investigation. Asked two things: whether they could confirm real
public reachability, and how urgently to mitigate.

User confirmed `guildserver.io` has expired and everything is moving to
`guild-technologies.com` (already configured as the second hostname on
every affected ingress — the exposure risk isn't resolved by the domain
expiring, since the alternate domain carries the same ingress config).
Asked for the ClusterRoleBinding to be downgraded rather than the ingress
removed outright.

## What was done

1. Deleted the two `cluster-admin` ClusterRoleBindings, replaced with
   bindings to the built-in read-only `view` ClusterRole. Verified via a
   fresh `kubectl get` read.
2. Found Headlamp is ArgoCD-managed with `selfHeal:true` — the fix would
   likely have been silently reverted within minutes, since the chart's
   default in-cluster mode appears to recreate the cluster-admin binding
   and the Application's values don't override that.
3. Patched the `Application/headlamp` sync policy to `selfHeal: false`
   (asked first) so the fix holds. Verified via a fresh read.
4. Re-verified the RBAC downgrade one final time after the patch — still
   holding.

## What this is and isn't

This is a mitigation, not a resolution. `view` access still exposes full
cluster state (every object, every namespace, just not Secret values or
write access) to anyone who reaches the ingress unauthenticated. The real
fix — OIDC login or removing the public ingress — is flagged as follow-up,
not done today. The other public services on this cluster (argocd,
coolify, grafana, portainer, jellyfin, rabbitmq) have not been checked for
equivalent issues; Headlamp was checked first as the single highest-
severity possible category.

## What changed

- Live change: 2 ClusterRoleBindings (Guild-B k8s cluster) downgraded
  cluster-admin → view; `Application/headlamp` sync policy patched
  (selfHeal true → false).
- `docs/decisions/2026-08-08-g21-headlamp-cluster-admin-exposure.md` —
  full decision record.
- `docs/phase-0/gap-register.md` — G-21 updated with the finding and
  mitigation status; severity split (Critical sub-finding mitigated,
  parent gap stays High pending the other services).

## Still open

Other Guild-B public services unreviewed. `selfHeal:false` on the
headlamp Application is a deliberate temporary pause, not permanent — it
needs the chart values fixed and self-heal re-enabled, or it'll silently
drift from Git indefinitely. `guild-technologies.com`'s actual live status
wasn't independently confirmed this session.
