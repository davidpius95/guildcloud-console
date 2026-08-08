# Decision record: G-21 — Headlamp unauthenticated cluster-admin exposure

**Date:** 2026-08-08
**Status:** mitigated (RBAC downgraded, ArgoCD self-heal paused for this
one Application). Not fully resolved — see "What's still needed" below.

## What was found

Investigating gap G-21 (Guild-B's unreviewed public-facing exposure), found
via QEMU guest-agent exec into `k8s-cp-1` (VM 120, `podA`, Guild-B cluster):

- `headlamp.guildserver.io` / `headlamp.guild-technologies.com` route to
  Headlamp — a full Kubernetes web dashboard — via an `nginx` Ingress with
  **no auth/oauth/basic-auth annotation of any kind** (checked every
  ingress object in the cluster for these annotations; none exist anywhere).
- Headlamp is deployed with `-in-cluster` mode (its own args:
  `["-in-cluster", "-in-cluster-context-name=main", ...]`), meaning it
  authenticates to the Kubernetes API using its own ServiceAccount token on
  behalf of whoever loads the page — it does not require the visitor to
  present their own credentials.
- That ServiceAccount (`headlamp`, namespace `headlamp`) was bound to
  **`cluster-admin`** via `ClusterRoleBinding/headlamp-admin`. A second,
  unrelated ServiceAccount (`headlamp-admin`) was also bound to
  `cluster-admin` via `ClusterRoleBinding/headlamp-ui-admin`.

**Net effect if reachable:** anyone who loads `headlamp.guild-technologies.com`
(or the now-expired `.guildserver.io`) gets a web UI with full,
unauthenticated `cluster-admin` control of the Guild-B Kubernetes cluster —
read/write/delete on every resource in every namespace, including Secrets.

## What could not be verified

Could not get a live TCP handshake to any of the public domains or the
cluster's LoadBalancer/NodePort addresses from this session's sandbox — all
outbound attempts timed out, which is consistent with sandbox network
egress restrictions, not proof of anything about real-world reachability.
**The user confirmed `guildserver.io` itself has expired** and is being
retired in favor of `guild-technologies.com`, which is already configured
as the second hostname on every affected ingress (`argocd`, `coolify`,
`grafana`, `headlamp`, `jellyfin`, `rabbitmq`, `requests`, `datacenter` —
all of them, not just headlamp). Whether `guild-technologies.com` is
currently live and publicly resolving was not independently confirmed in
this session — worth checking directly.

## What was done (with explicit sign-off at each step)

1. Deleted `ClusterRoleBinding/headlamp-admin` and
   `ClusterRoleBinding/headlamp-ui-admin` (both bound to `cluster-admin`).
2. Created replacements bound to the built-in, read-only `view` ClusterRole
   instead: `headlamp-view` (for SA `headlamp`) and `headlamp-admin-view`
   (for SA `headlamp-admin`). `view` excludes Secret contents by default.
3. Verified via a fresh `kubectl get clusterrolebinding` read (not assumed
   from command exit status) that both bindings now show `view`.
4. Found Headlamp is ArgoCD-managed (`Application/headlamp`, upstream
   `kubernetes-sigs.github.io/headlamp` chart, `selfHeal:true` /
   `prune:true`) — meaning step 1–2 would likely be silently reverted on
   ArgoCD's next reconciliation, since the chart's default in-cluster mode
   appears to create the `cluster-admin` binding and the Application's
   inline `valuesObject` doesn't override that.
5. Patched `Application/headlamp`'s sync policy to `selfHeal: false`
   (leaving `prune: true` unchanged) so the RBAC downgrade holds. Verified
   via a fresh read: `{"prune":true,"selfHeal":false}`.
6. Re-verified the ClusterRoleBindings one more time after the patch —
   still `view`, not reverted.

## What's still needed (not done today, flagged for follow-up)

- **This is a mitigation, not a fix.** `view` still lets an unauthenticated
  visitor browse every resource in the cluster (ConfigMaps, pod specs,
  events, RBAC objects themselves) — just not modify anything or read
  Secret values. That's still a real information-disclosure exposure if
  the ingress is actually public.
- **The real fix is proper authentication** — either configure Headlamp's
  OIDC flow (its supported, documented production auth model) so visitors
  must log in with their own identity, or remove the public ingress
  entirely until that's done, restricting access to a private/VPN-only
  path.
- `Application/headlamp`'s `selfHeal` is now `false` — this is a
  deliberate, temporary pause, not a permanent setting. It should be
  flipped back to `true` once the chart's values are updated to not
  recreate the `cluster-admin` binding, otherwise this Application will
  silently drift from its Git-tracked state indefinitely.
- **All the other `*.guild-technologies.com` ingresses** (argocd, coolify,
  grafana, portainer, jellyfin, rabbitmq, requests, datacenter/PDM) have
  not been checked for equivalent unauthenticated-privileged-access issues.
  This session only investigated Headlamp specifically, because it's a
  full cluster dashboard and therefore the most severe possible finding
  category. Portainer (Docker/container management) is a similarly
  high-value target to check next.
- Confirm whether `guild-technologies.com` is actually live/public right
  now — this session could not verify from its sandbox.

## What changed

- Live change: 2 ClusterRoleBindings replaced (cluster-admin → view) on
  the Guild-B Kubernetes cluster; `Application/headlamp` sync policy
  patched (selfHeal true → false).
- `docs/phase-0/gap-register.md` — G-21 updated with this finding and
  mitigation status.
