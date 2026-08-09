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

**Verification pending:** the client was created by the user in the
Tailscale admin console and its id/secret stored in Vault
(`tailscale_guildcloud_worker_oauth_client_id`/`_secret`). Whether the
OAuth-token-exchange → key-creation → device-registration chain works
end-to-end has not yet been proven with a real instance as of this
writing — that's the pending real end-to-end test.

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

**Verification:** pending the real end-to-end test — this exact gate is
what should visibly hold a fresh project's first instance at
`network_access_attach` until `applyPendingProjectAcls()` catches up on a
subsequent invocation.
