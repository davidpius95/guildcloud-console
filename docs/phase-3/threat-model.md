# Phase 3 Slice 1 — Threat Model

Same format as prior phases: what the threat is, the mitigation, and how
to verify the mitigation actually holds.

## 1. The finding that made this phase urgent (see `docs/phase-2/threat-model.md` findings #8/#9 for full detail)

A hardcoded, reusable, plaintext Tailscale auth key was baked into the old
template's (`vmid 9000`) cloud-init vendor-data, applied to every clone
under a fully-open ACL. **Status of the key itself as of this writing:
revocation not independently confirmed** — the user was told to revoke it
in the Tailscale admin console; this phase's own work (real per-instance
keys, no shared key anywhere) doesn't touch that old key at all, so its
revocation is still a separate, outstanding action item.

## 2. Tailscale OAuth client scope — resolved via reasoning, not live testing

**Original plan:** scope the worker's OAuth client narrowly to
`tag:guildcloud-tenant` only, matching the least-privilege discipline
already applied to the Proxmox token.

**Found before writing any code, not after:** Tailscale OAuth clients have
their tag scope fixed at creation time in the admin console. Per-project
tags (`tag:guildcloud-tenant-<slug>`) don't exist until a project is
created — a client scoped narrowly upfront can never be retroactively
scoped to cover tags that don't exist yet. This is a structural constraint
of the platform, not something a live test could resolve differently.

**Resolution:** the OAuth client is broadly scoped (Devices Core + Auth
Keys, not tag-restricted) — a trusted worker credential, the same class of
trade-off already accepted for the Supabase service-role key this session.
The real isolation boundary is the **ACL grants list**, which does support
dynamic per-project entries (confirmed technically works via the live
API), not the client's own scope.

**Verified 2026-08-09:** real end-to-end test (operation
`7ee55e24-5ae3-4863-8958-4aae4d2e9f6e`, instance `phase3-e2e-test-1`)
reached `ready`. The OAuth-token-exchange → key-creation →
`tailscale up` → device-registration chain worked for real, independently
confirmed via `list_devices` from this session (not just the worker's own
self-report): device `instance-4f1d652b`, IP `100.100.219.91`, tags
`tag:guildcloud-tenant` + `tag:guildcloud-tenant-project-5e81b859` — both
correct. Console's real "Private address allocation" table showed the
same IP/hostname.

## 3. Per-project ACL grants bypass the GitOps-only rule — a deliberate, user-approved exception

`infra/tailscale/README.md` states plainly: "every ACL change is a PR...
No direct API calls... will be silently overwritten by the next PR-driven
apply." Per-project tenant grants can't wait on a human merging a PR at
project-creation time, so the site worker calls the live Tailscale API
directly for this one narrow case (`applyPendingProjectAcls()`).

**This was not decided unilaterally** — asked the user directly, given two
real options (worker calls API directly vs. a generated-commit +
CI-apply flow), and they chose speed over strict governance for this
specific mechanism.

**Real, accepted cost:** `infra/tailscale/policy.hujson` in git will drift
from the live per-project grants list — the file only reflects the static
sections (mgmt/operator/tenant-umbrella/backup) accurately from this point
forward. **Mitigation not yet built:** a periodic job that reads the live
policy and commits it back for audit (not enforcement). Flagged as
follow-up work, not done this pass.

## 4. Worker LXC needed real infrastructure changes, not just code

`automated_verification`'s real reachability check requires the worker's
own host to be on the tailnet. It wasn't. Getting there required Proxmox
device passthrough (`/dev/net/tun`) for an unprivileged LXC — a real
operation restricted to the interactive `root@pam` session (confirmed live:
an API token, even a fully-privileged one, gets a hard 403 for this
specific operation). The user did this step directly on the Proxmox host,
not through any tool available to this session.

**Verification:** `guildcloud-site-worker-guild-a` confirmed live in
`list_devices`, tagged `tag:guildcloud-mgmt`, authorized.

## 5. Ephemeral, single-use keys — the actual fix for the original finding

Every real instance enrollment now mints a key with `reusable: false`,
`ephemeral: true`, a 10-minute expiry, and tags baked in at creation time
(no separate device-retag call needed, which also sidesteps a second
uncertain OAuth-client-scope question about whether a client can retag a
device after creation). A key that's never used expires harmlessly; a key
that is used can never be reused for a second device. This directly
closes the class of bug finding #1 was — no shared, no reusable, no
long-lived key anywhere in the provisioning path.

## 6. Real instance deletion still doesn't exist — this phase makes the gap sharper, not new

Already flagged in `docs/phase-2/threat-model.md` finding #7's
neighbor sections: no real `deleteInstance` action exists.
`instances.tailscale_device_id` is now populated for real, which means a
manually-deleted VM (the only deletion path that exists today) leaves a
real, tagged, inert Tailscale device registration behind indefinitely.
Given keys are ephemeral/single-use, this is a hygiene gap (a stale device
entry), not a live credential leak — but it should be closed when real
instance deletion is eventually built: that action must deauthorize/delete
the Tailscale device using this column, mirroring how
`network_access_attach` creates it.

## 7. `network_access_attach` gates on ACL state before enrolling — no silent islands

**Threat:** enrolling a device into `tag:guildcloud-tenant-<slug>` before
the corresponding ACL grant exists would create a real device with no
reachability grant at all — not a failure the console would show, since
the worker's own next stage (`automated_verification`) would just keep
retrying forever on a device that's technically "enrolled" but reachable
by nobody.

**Mitigation:** `network_access_attach` explicitly checks
`projects.tailscale_acl_state === 'applied'` before minting any key,
using the existing `retry_wait` mechanism to wait rather than enroll
speculatively.

**Verification:** confirmed live 2026-08-09 — all 3 real projects showed
`tailscale_acl_state = applied` before the test instance's
`network_access_attach` was allowed to mint a key, and the real ACL policy
(`manage_acl get`) contained the matching grant before enrollment proceeded.

## 8. Two real, live-only blockers found during the actual end-to-end test — not caught by design review

Both were only discoverable by actually running the flow against real
infrastructure, not by reading code:

1. **The worker's own Proxmox token lacked `VM.GuestAgent.Unrestricted`.**
   `GuildCloudSiteWorker`'s role had `VM.GuestAgent.Audit` (ping only,
   inherited from before this phase, when the worker only ever polled
   guest-agent readiness) but not the separate privilege `agent/exec`
   requires. First real enrollment attempt got a live 403: `Permission
   check failed (/vms/591904, VM.GuestAgent.Unrestricted)`. **Fix:** added
   `VM.GuestAgent.Unrestricted` to the role live via the Proxmox API (`PUT
   /access/roles/GuildCloudSiteWorker`). A real, accepted privilege
   expansion for the worker's existing credential — it already had
   `VM.PowerMgmt`/`VM.Clone` etc. on every guest it manages, so this is not
   a new blast-radius category, just a missing grant within the same trust
   boundary.
2. **`tailscaled` ships disabled on template `9011`** (deliberately, per
   `data-model.md`, to avoid any risk of a baked-in node identity) — but
   `network_access_attach` assumed the daemon was already running and just
   called `tailscale up` directly. First real attempt failed: `failed to
   connect to local tailscaled; it doesn't appear to be running`. **Fix:**
   the guest-exec command now runs `systemctl enable --now tailscaled &&
   tailscale up ...` as one command — starting the disabled-by-design
   daemon is now an explicit, per-enrollment step, not an assumption. Fixed
   in `supabase/functions/site-worker-guild-a/index.ts`; the live
   `/opt/guildcloud-worker/index.js` on the Guild-A LXC still needs the same
   one-line change pasted in before the next real customer instance goes
   through this path.
