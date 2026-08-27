# 2026-08-27 — Custom Cloudflare domain for Vercel prod + two ingress route bugs found and fixed

## What changed

**1. `cloud.guild-technologies.com` now points at the real Vercel production
deployment** (`guildcloud-console.vercel.app`, `davidpius95s-projects/guildcloud-console`).

- `vercel domains add cloud.guild-technologies.com guildcloud-console`
  attached the domain to the project.
- Cloudflare DNS record for `cloud` (previously an A record resolving to
  Cloudflare's proxy IPs, silently caught by the Guild-A ingress Tunnel with
  no matching Caddy route — a 404) was replaced with a CNAME to
  `52dae08c8afde49b.vercel-dns-017.com.`, proxy **disabled** (DNS-only/grey
  cloud), per Vercel's own `domain-connect` recommendation.
- `vercel domains verify cloud.guild-technologies.com` →
  `configured-correctly`, cert issued via `http-01`. Confirmed live:
  `curl -I https://cloud.guild-technologies.com/` → `200`, `server: Vercel`.
- This is deliberately isolated from the Guild-A Cloudflare Tunnel/Caddy
  setup that serves `*.guild-technologies.com` today (`argocd`, `portainer`,
  `headlamp`, `grafana`, `guildcloud-console`, `stateful`, etc. — see
  `docs/phase-0/gap-register.md` G-21): an unproxied CNAME for one specific
  hostname bypasses the Tunnel entirely for that name only, so nothing else
  routed through the Tunnel/Caddy was touched.

**2. Found and fixed two real bugs in `guildcloud-console.guild-technologies.com`'s
routing**, discovered while investigating why the browser got a `502` there.

Both live in `/etc/caddy/routes/guildcloud-console.json` on the Guild-A
ingress LXC (`nodeA`, vmid 910, container name `ingress` — runs both
`caddy-ingress` and `cloudflared`, config regenerated from
`/etc/caddy/routes/*.json` into `/etc/caddy/caddy.json` via
`/usr/local/bin/apply-routes`):

- **Stale dead IP.** The route dialed `192.168.8.107:8081` — a host with
  no route to it at all (`ping`/`curl` both failed: "No route to host").
  Caddy's own error log confirmed the exact failure:
  `dial tcp 192.168.8.107:8081: i/o timeout` → `502`. The correct host,
  `192.168.8.106` (VM `guildcloud-dev`, vmid 100, podC, Guild-B cluster),
  was already right there in the sibling routes (`guildcloud-api.json` →
  `192.168.8.106:8080`, `guildcloud.json` → `192.168.8.106:3000`) — someone
  had updated those but not `guildcloud-console.json`, and never re-ran
  `apply-routes` to catch the drift.
- **Wrong port on the corrected host.** After pointing at `.106`, the route
  still 404'd — `192.168.8.106:8081` turned out to be
  `guildcloud-worker.service` (the fleet worker / agent control plane
  binary, `guildcloud-work`), not a web frontend, hence the bare Go
  `net/http` "404 page not found" on `/`. The actual portal
  (`guildcloud-portal.service`, Next.js) listens on `:3000` — same port the
  bare `guildcloud.json` route already (correctly) uses. Repointed
  `guildcloud-console.json` to `192.168.8.106:3000` to match.

Both fixes applied via `sed` on the route file + `/usr/local/bin/apply-routes`
(rebuilds `/etc/caddy/caddy.json` from all `routes/*.json` and hot-reloads;
"applied 22 route(s) (live)" both times). No other route file was touched.

## Why

The user asked what service was running at
`guildcloud-console.guild-technologies.com` (it was returning a live `502`),
then asked to point a new subdomain, `cloud.guild-technologies.com`, at the
already-working Vercel production deployment "without breaking the system,"
then asked to fix the broken self-hosted route once its root cause was found.

## Verified

- `curl -I https://cloud.guild-technologies.com/` → `200`, `server: Vercel`,
  `x-vercel-cache: HIT`.
- `vercel domains verify cloud.guild-technologies.com` → `"status": "ok"`,
  `"configurationStatus": "configured-correctly"`.
- `curl -I https://guildcloud-console.guild-technologies.com/` → `307` to
  `/sign-in` (real Next.js portal response, not a 502 or a wrong-service 404).
- Live `caddy.json` re-read after each `apply-routes` run to confirm the
  `dial` value actually changed (not just that the route file on disk did).

## What's still open

- The drift itself — why `guildcloud-console.json` fell behind its siblings
  and `apply-routes` wasn't re-run after — wasn't root-caused; there's no
  guard today that alerts when a route file's `dial` target stops resolving
  or starts 404ing. Worth a periodic health check per route (e.g. via the
  existing `uptime-kuma` LXC on Guild-B, or a simple curl-and-diff cron on
  the ingress box) so a repeat of this doesn't sit unnoticed until someone
  hits it in a browser.
- `cloud.guild-technologies.com` is a second public URL for the same
  Vercel deployment as `guildcloud-console.vercel.app` — no redirect/canonical
  decision has been made between them yet (not asked for; noting so it
  doesn't get assumed as decided).
