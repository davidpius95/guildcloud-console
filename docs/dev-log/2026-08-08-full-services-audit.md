# Dev log — 2026-08-08: remaining services audit (Guild-B + Guild-A)

## What happened

Follow-up to the Headlamp critical finding. Audited every other Guild-B
public service, then — after correcting a scope mistake — audited
Guild-A's legacy workloads too.

## Guild-B: one real finding, accepted by the user

Queried every ClusterRoleBinding and Ingress annotation in one pass.
Found Portainer's ServiceAccount bound to `cluster-admin`, ingress live
on the **current** domain (`portainer.guild-technologies.com`, not just
the expired one), no ingress-level auth. Unlike Headlamp, Portainer has
its own real login — so this isn't an open door, but a compromise of that
one login means instant full cluster-admin. The binding carries `owner:
david`, meaning this was a deliberate choice, not an accidental chart
default.

Presented three options (leave it, downgrade like Headlamp, scope to
least-privilege). User chose to leave it, understanding the tradeoff —
documented as an accepted risk, not a silently-skipped finding.

ArgoCD (broad `get/delete/patch` on `*`) and Grafana (read-only on all
Secrets cluster-wide) were also checked — both are standard, expected
patterns for their respective tools, not misconfigurations.

## Scope correction

Realized mid-audit that `coolify`, `jellyfin`, `rabbitmq`, `requests`, and
`datacenter`/PDM aren't Guild-B Kubernetes services at all — only 6 real
`Ingress` objects exist on that cluster. Those five domains route to
Guild-A's existing legacy workloads instead, reverse-proxied separately.
Corrected the gap register rather than silently letting the wrong
assumption stand.

## Guild-A: clean result

Since these are LXC containers (no guest-agent exec mechanism available
via the API, unlike QEMU VMs), tested each service directly over the
network — the same view a real visitor would have. Every service checked
out clean: Jellyfin, Coolify, Jellyseerr, Radarr, and Sonarr all redirect
to real login pages (not incomplete setup wizards); RabbitMQ's `guest`
account is correctly localhost-restricted; PDM requires auth even for
version info; Caddy's admin API isn't externally reachable. No findings,
no fixes needed — a genuinely good result, reported as such rather than
manufacturing concern where there wasn't any.

## What changed

- No live infrastructure was changed in either audit.
- `docs/decisions/2026-08-08-g21-remaining-services-audit.md` — Guild-B
  findings and the user's Portainer decision.
- `docs/decisions/2026-08-08-guilda-legacy-auth-audit.md` — Guild-A clean
  audit result.
- `docs/phase-0/gap-register.md` — G-21 updated with both.

## Session status

G-21 is now as complete as it can be without either (a) revisiting the
user's accepted Portainer risk, or (b) finding LXC-internal tooling this
session doesn't have. All of today's originally-scoped work (gap register
sweep, Guild-B discovery and hardening, Headlamp mitigation, this audit)
is done.
