# Alerting on "can this site still create instances" — and the notification channel that never worked

**Date:** 2026-09-03
**Trigger:** the standing "no alerting" gap. Instance creation broke on
2026-08-29 and again on 2026-09-03, and both times it was found by a human
running the flow by hand.

Two separate problems were found. The second one is much worse than the first.

## Problem 1 — every monitor was a liveness check

Uptime Kuma was already running (LXC 101 on podC, 192.168.8.104) with 30+
monitors: `ping` to all 11 Proxmox hosts, `http` to every PVE UI, and the
public service URLs.

Not one of them could have fired during either outage. The hosts were up, the
PVE UIs answered, the public sites were fine — and the platform could not create
a single instance. **Liveness is not readiness.** Nothing asserted that the
thing the business sells still worked.

### What was added

Three Kuma **push** monitors, all wired to the existing Telegram notification:

| id | monitor | interval | fed by |
| --- | --- | --- | --- |
| 46 | Guild-A can provision (snippet store) | 180s | `provisioning-probe.js` on guild-a worker LXC |
| 47 | Guild-B can provision (snippet store) | 180s | `provisioning-probe.js` on guild-b worker LXC |
| 48 | guild-pbs datastore capacity | 900s | `datastore-capacity-probe.sh` on guild-pbs |

Push rather than pull, deliberately: a push monitor treats *silence* as failure,
so a dead probe, a dead worker LXC or a dead timer raises the alert on its own
with nothing extra to configure.

`deploy/site-worker/provisioning-probe.js` runs every minute from
`guildcloud-provisioning-probe.timer` and:

1. **Actually writes** a file into `SNIPPETS_DIR` and fsyncs it. Not a stat — the
   2026-09-01 fault was `ESTALE` on a store with plenty of free space, and the
   2026-09-03 fault was `ENOSPC` that NFS only reports at flush. A stat-only
   check would have missed both.
2. Reads free space and compares against **the admission gate's own numbers**
   (`>= 1 GiB free`, `>= 5% free`, imported as named constants). The probe and
   `can_provision_instance` cannot drift into disagreeing about whether the site
   is sellable.
3. Warns at 2 GiB — above the floor — so the page arrives while creates still
   work rather than after they start failing.

It reads the same `/etc/guildcloud/worker.env` the worker does, so it checks the
exact directory the worker writes to. A probe with its own copy of the path
would eventually check the wrong thing.

`deploy/guild-pbs/datastore-capacity-probe.sh` is POSIX sh + curl on purpose:
guild-pbs is a PBS appliance and should not grow a Node runtime for a 20-line
check. Snippets no longer share that filesystem, so a full disk there breaks
backups and GC rather than provisioning — the message says so.

## Problem 2 — Uptime Kuma could not send notifications at all

Found only because the new monitor was tested by deliberately failing it:

```
[MONITOR] ERROR: Cannot send notification to Telegram (GuildInfrabot)
Error
    at Telegram.send (notification-providers/telegram.js:31:23)
```

**Uptime Kuma has never been able to alert anyone.** Every one of those 30+
monitors was decorative. The dashboard was green, the alerting was dead, and
nothing about the system said so — which is a considerably worse failure than
having no monitoring, because it looks like coverage.

### Diagnosis

The bot itself was fine. `getMe` and `sendMessage` over curl both returned 200
and delivered a real message, so the token and chat id were valid.

The failure was one layer down, and intermittent:

```
node ERR ETIMEDOUT after 482ms     curl 200 in 5.32s
node OK 200 in 1006ms              curl 200 in 4.13s
node ERR ETIMEDOUT after 428ms     curl 200 in 0.86s
```

`ETIMEDOUT` after ~450ms of a 20s timeout is not a timeout — it is a connection
attempt being abandoned. `api.telegram.org` resolves to both A and AAAA; this
container has an IPv6 address from Tailscale but **no IPv6 route to the
internet** (`curl -6` fails outright). Node 20's Happy Eyeballs
(`autoSelectFamily`, on by default) returns `ETIMEDOUT` instead of falling back
to the working IPv4 address. curl falls back correctly, which is exactly why
every manual check of this box looked healthy.

`--dns-result-order=ipv4first` does **not** fix it — autoSelectFamily still
attempts both. Measured:

| | result |
| --- | --- |
| default | FAIL ETIMEDOUT |
| `--dns-result-order=ipv4first` | FAIL ETIMEDOUT |
| `--no-network-family-autoselection` | **OK 200** |

### Fixed

1. `/etc/gai.conf` on the Kuma container: `precedence ::ffff:0:0/96  100`, so
   `getaddrinfo` returns the IPv4 address first for everything on the box.
2. systemd drop-in `uptime-kuma.service.d/10-ipv4-fallback.conf`:
   `Environment=NODE_OPTIONS=--no-network-family-autoselection`.

Both are needed: the flag stops Node racing the dead IPv6 address, gai.conf
makes the single address it then uses the IPv4 one.

## Verified

A full down → up → down cycle was forced on monitor 47 by raising the probe's
warn threshold (no real outage, no customer impact), after which:

- every transition recorded `important=1`, which is the flag Kuma sets when it
  dispatches notifications;
- `Cannot send notification` count since the fix: **0** (it was failing on every
  single attempt before);
- all three monitors settled back to status 1.

Final state:

```
46  Guild-A can provision (snippet store)  1  guild-a: snippet store writable, 3.91 GiB free (99.7%)
47  Guild-B can provision (snippet store)  1  guild-b: snippet store writable, 3.91 GiB free (99.7%)
48  guild-pbs datastore capacity           1  guild-pbs: backup datastore 85GB free (71% used)
```

Gate: `typecheck` clean, `lint` clean, `test:worker` 206/206 (8 new).

## Still open

1. **The other 30+ monitors have never been verified end-to-end.** They can
   *now* notify, but no one has confirmed any of them actually fires on a real
   failure. The Telegram fault proves that "the monitor exists" and "someone
   gets told" are different claims.
2. **Nothing yet alerts on the admission verdict itself.** The probe checks the
   snippet store, which is what broke twice. A monitor that called
   `can_provision_instance` directly would also catch a dead worker heartbeat,
   an untested template, or exhausted memory/vCPU. That needs a credential the
   probe does not currently hold.
3. **One notification channel, one recipient.** Telegram to a single chat id. If
   that bot is revoked the platform is silently back to no alerting — the exact
   failure just fixed. A second channel is worth having.
4. **Kuma's own monitors are stored only in its SQLite DB.** The three new ones
   were inserted directly and are not reproducible from this repo. If that
   container is lost they are gone.
