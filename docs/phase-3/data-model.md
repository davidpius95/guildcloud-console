# Phase 3 Slice 1 — Data Model

**Built:** 2026-08-09, layered on the Phase 2 schema in the same Supabase
project (`ssbleuvjxlgttlkoancu`). Real per-instance Tailscale private
access — see `threat-model.md` for the critical finding (a hardcoded,
shared, exposed Tailscale auth key baked into the old template's
cloud-init) that made this phase urgent rather than merely next-in-line.

## `instances` (altered)

| Column | Type | Notes |
| --- | --- | --- |
| `private_hostname` | text, nullable | new. The Tailscale MagicDNS name, written by the worker's `network_access_attach` stage after real enrollment |
| `tailscale_device_id` | text, nullable | new. The Tailscale device ID, needed to deauthorize/delete the device once real instance deletion exists (it doesn't yet — see finding in `threat-model.md`) |

`private_ip` (already existed, unpopulated since Phase 2) is now
written for real by the same stage.

## `projects` (altered)

| Column | Type | Notes |
| --- | --- | --- |
| `slug` | text, not null, unique | new. Generated once at `createProject` time from the project's own id (`project-<8 hex chars>`), **never** recomputed from the renamable `name` column — it becomes part of a live Tailscale tag (`tag:guildcloud-tenant-<slug>`) that the ACL policy references by exact string, so it must never change once set |
| `tailscale_acl_state` | text, check ∈ `pending, applied, failed`, default `pending` | new. Durable state — `createProject` never calls the Tailscale API synchronously; the site worker picks up `pending` rows and applies the real per-project ACL grant asynchronously, same pattern `createInstance`/`operations` already uses for provisioning |

Backfilled for the 2 pre-existing projects (`Production`, `Sandbox`) —
checked live for name collisions first (none, and slug doesn't derive from
name anyway).

## New Tailscale-side state (not in Postgres)

- `tag:guildcloud-tenant` — umbrella tag, declared in
  `infra/tailscale/policy.hujson` via the normal PR/GitOps flow (this one
  is static, known ahead of time — unlike per-project tags).
- `tag:guildcloud-tenant-<slug>` — one per real project, declared and
  granted **dynamically by the site worker via the live Tailscale API**,
  not committed to `policy.hujson` — see `threat-model.md` for why this is
  a deliberate, documented exception to the "no direct API calls" rule,
  not a silent bypass.
- Two new Vault secrets: `tailscale_guildcloud_worker_oauth_client_id`,
  `tailscale_guildcloud_worker_oauth_client_secret` — a broadly-scoped
  OAuth client (Devices Core + Auth Keys, not tag-restricted — see
  `threat-model.md` for why tag-restriction doesn't work for dynamically
  created project tags).

## Worker changes (`supabase/functions/site-worker-guild-a/index.ts`,
kept in sync with the live Node.js worker on the Guild-A LXC)

- New `tailscaleAccessToken()`/`ts()` helpers, mirroring
  `proxmoxToken()`/`pve()`.
- New `applyPendingProjectAcls()`, run once per invocation before the
  stage loop: for every `projects` row with `tailscale_acl_state =
  'pending'`, fetches the live ACL policy, appends a
  `tag:guildcloud-tenant-<slug>` grant (self + mgmt reachable), applies it,
  marks `applied`. Leaves `pending` on failure — same durable-retry
  approach as everything else this worker does, no separate error/backoff
  state needed.
- `network_access_attach` (previously an unconditional `skipped`) is now
  real: waits for the owning project's ACL state to be `applied` and the
  guest agent to be reachable (both via the existing `retry_wait`
  mechanism — no change to the fixed stage enum needed), mints a
  short-lived (10-minute), single-use, ephemeral Tailscale key tagged with
  both the umbrella and project-specific tags, runs `tailscale up` inside
  the guest via `agent/exec`, looks up the resulting device, writes
  `private_ip`/`private_hostname`/`tailscale_device_id`.
- `automated_verification` extended (Node.js worker only — the Deno
  Edge-Function copy can't do a real local network probe, kept for
  parity/documentation only): after the existing guest-agent ping, does a
  real TCP connect to the instance's private IP on port 22, from the
  worker's own now-tailnet-joined host — proof of actual reachability +
  SSH-service presence, not just trusting the Tailscale API's "online"
  flag.

## Guild-A LXC itself joined the tailnet (real infrastructure change, not
just schema)

`guildcloud-site-worker-guild-a` (LXC `vmid 500`) is now a real Tailscale
device, tagged `tag:guildcloud-mgmt`. Required because
`automated_verification`'s reachability check needs the worker's own host
to have a route into the tailnet — it didn't before this phase. Getting
here required Proxmox device passthrough for `/dev/net/tun`
(`pct set 500 -dev0 /dev/net/tun`) — unprivileged LXC containers have no
TUN device by default, and granting one is restricted to the real
interactive `root@pam` session, not even a privileged API token.

## Template: `vmid 9011` (new)

Full clone of `9010` with the Tailscale package pre-installed on disk
(service disabled, no `tailscaled.state` file — confirmed empty `{}`
before deletion, so no risk of every clone inheriting the same node
identity). `catalog_image_site_templates` repointed at it; `9010` stays
untouched as rollback. Per-clone work is now just `tailscale up` with a
fresh key — installing the package per-clone was exactly the kind of
first-boot network dependency the 2026-08-09 speed fix already removed
once for `apt-get update`/AppStream.
