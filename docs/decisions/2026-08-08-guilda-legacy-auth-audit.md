# Decision record: Guild-A legacy workload authentication audit

**Date:** 2026-08-08
**Status:** complete. No findings — all services checked are properly
secured. No live changes made (none needed).

## Context

Follow-up to the Guild-B services audit, which found that `coolify`,
`jellyfin`, `rabbitmq`, `requests`, and `datacenter` (PDM) aren't
Kubernetes services at all — they're Guild-A's existing legacy workloads,
reverse-proxied under the same domain umbrella via Guild-A's own `ingress`
container (CT910, Caddy). User asked for this checked too, now that the
scope correction was made.

## Method

Since these run in **LXC containers**, not QEMU VMs, there's no
guest-agent exec mechanism available (Proxmox's API has no LXC
equivalent to QEMU's `agent/exec`). Tested each service directly over the
network instead — real HTTP requests against the actual running services,
the same thing an external visitor would see.

## Findings — all clean

| Service | IP:Port | Result |
| --- | --- | --- |
| Jellyfin | `192.168.8.244:8096` | `StartupWizardCompleted: true` — fully initialized, not exploitable via setup-wizard hijack. |
| RabbitMQ management | `192.168.8.245:15672` | Default `guest` account correctly rejected: *"User can only log in via localhost"* — RabbitMQ's own secure default since v3.3 (not a custom fix, but confirmed active, not disabled). |
| Coolify | `192.168.8.30:8000` | Redirects to `/login`, not a setup wizard. Fully initialized. |
| PDM (Proxmox Datacenter Manager) | `192.168.8.247:8443` | Unauthenticated API call to `/api2/json/version` correctly returned `"authentication failed"` — requires auth even for basic info. |
| Jellyseerr ("requests") | `192.168.8.246:5055` | Redirects to `/login`. Fully initialized. |
| Radarr | `192.168.8.246:7878` | Redirects to `/login`. Fully initialized. |
| Sonarr | `192.168.8.246:8989` | Redirects to `/login`. Fully initialized. |
| Caddy admin API (ingress, CT910) | `192.168.8.10:2019` | Not reachable — binds to localhost only, Caddy's secure default. Not exposed externally. |

Every service checked either requires real authentication or has its
admin surface correctly bound to localhost-only. None showed the
Headlamp-class pattern (no auth at all) or an incomplete setup wizard
that would let the first visitor claim an admin account.

## What this doesn't cover

- Password strength / credential reuse for any of these logins — not
  testable without credentials, and not something to probe on someone's
  real, actively-used services.
- Whether any of these have known CVEs unpatched (would need version-by-
  version vulnerability lookups, not done here).
- LXC-internal configuration (couldn't exec into these containers at all
  — no API mechanism for it) — this audit is external/network-only,
  which is also exactly what a real attacker would see, but it can't
  catch anything that's only visible from inside the container.

## What changed

Nothing — no fixes were needed. This is a clean audit result, documented
for the record.
