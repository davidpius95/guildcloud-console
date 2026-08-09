# Dev log — 2026-08-09: Phase 3 Slice 1, real per-instance Tailscale private access

## What was asked

Start scoping and building Phase 3 (private access) — following directly
from the critical Tailscale key exposure found while investigating
provisioning speed. Planned properly (research → Plan agent → written plan
→ user approval) before writing any code, matching this session's
established discipline for non-trivial work.

## Real research before designing anything

Read the master plan's actual §6/§7 text (not paraphrased — the docx
lives outside the repo, extracted directly via a zip/XML read since
`pandoc` wasn't available in this environment). Read the real, live state:
`docs/decisions/2026-08-07-tailscale-tenancy-model.md` (tag design already
decided, tenant grants explicitly deferred to "the same PR that builds
Phase 3 device enrollment" — this work), the live ACL policy
(`manage_acl` get), and the live device list — which is how a real,
unplanned prerequisite was found: **the worker's own LXC had no Tailscale
client at all**, so it had no route to do a real reachability check
against any instance it might enroll.

## Two real findings resolved before writing worker code

1. **Tailscale OAuth clients have a fixed tag scope, set at creation.**
   Per-project tags don't exist until a project is created, so a client
   scoped narrowly upfront structurally can't cover them later. Resolved
   by reasoning, not a live test that couldn't actually answer this:
   broadly-scope the OAuth client (a trusted worker credential, same class
   of trade-off as the service-role key), and make the ACL grants list —
   which does support dynamic per-project entries — the real isolation
   boundary instead of client scope.
2. **Per-project ACL grants can't go through the existing GitOps-only
   flow.** `infra/tailscale/README.md` states plainly that direct API
   calls will be silently overwritten by the next PR-driven apply. Asked
   the user directly rather than deciding unilaterally; they chose speed
   (worker calls the API directly for this one case) over strict
   governance, accepting that the committed policy file will drift from
   live per-project grants (mitigation: a periodic sync-back job,
   flagged as follow-up, not built this pass).

## Built

- `tag:guildcloud-tenant` declared in `infra/tailscale/policy.hujson`
  through the actual PR/GitOps flow (committed, pushed, CI applied it) —
  the one static, foundational tag declaration, handled properly even
  though the dynamic per-project grants that follow are an accepted
  exception.
- Schema: `instances.private_hostname`/`tailscale_device_id`,
  `projects.slug`/`tailscale_acl_state`. `slug` generated once from the
  project's own id, never from the renamable `name`, since it becomes part
  of a live tag name.
- `createProject` (both the real one and the onboarding first-project
  path) generates `slug` and leaves ACL state `pending` — no synchronous
  Tailscale call in the request path, same deferred-work pattern
  `createInstance` already uses.
- Worker: `applyPendingProjectAcls()`, a real `network_access_attach`
  stage (mints an ephemeral single-use key with both tags baked in at
  creation — sidesteps a separate, uncertain "can a client retag a device
  after creation" question entirely), and an extended
  `automated_verification` (Node.js worker only) with a real TCP
  reachability/SSH-port check from the worker's own host.
- New template `vmid 9011`: full clone of `9010` with Tailscale
  pre-installed on disk (service disabled, confirmed empty `{}` state file
  deleted before conversion — no risk of every clone inheriting the same
  node identity). Repointed the catalog; `9010` stays as rollback.
- Console: `app/console/networking/page.tsx`'s "Private address
  allocation" table is now real (`getInstancesWithPrivateNetworkForOrg` +
  `private-address-table.tsx`), following the `ssh-keys-card.tsx`
  precedent. Verified live in the browser: shows the real pre-existing
  customer instance with `—` for private IP (correct — it predates this
  phase).

## Real infrastructure work along the way, not just code

- Minted a real Tailscale auth key (single-use, tagged `guildcloud-mgmt`)
  to join the worker LXC to the tailnet — this session's own tools
  couldn't mint one (`manage_keys` requires an admin risk level this
  session doesn't have), so the user generated it in the admin console.
- Hit a real, hard Proxmox restriction: TUN device passthrough for an
  unprivileged LXC is restricted to the interactive `root@pam` session,
  403s even for a fully-privileged API token. The user applied it
  directly on the Proxmox node (`pct set 500 -dev0 /dev/net/tun`).
- Building the new template hit two more real, live bugs: `agent/exec`
  needs `command` as an array, not a string (a plain string silently
  breaks on any command containing a pipe — found live, not from docs),
  and a genuine first-boot `apt-get dist-upgrade` held the dpkg lock for
  over 7 minutes before the Tailscale package install could proceed —
  waited it out rather than killing it (an interrupted dpkg transaction
  mid-upgrade risks a broken package database on what becomes a
  permanent template).

## Explicitly not done this pass

- The real end-to-end proof (create an instance through the actual
  console, watch `network_access_attach` mint a key and enroll it for
  real, independently verify reachability, clean up) — pending the
  updated worker script actually being deployed to the live LXC.
- Customer device self-enrollment (Slice 2) — `memberships.device_enrolled`
  stays unwired, deliberately out of scope for this slice.
- Real instance deletion still doesn't exist — this phase makes the
  resulting orphaned-Tailscale-device gap sharper (now there's a real
  device to leave behind), not new.
- Revoking the original critical exposed key — still the user's own
  outstanding action, unrelated to and not fixed by any of this phase's
  work.
