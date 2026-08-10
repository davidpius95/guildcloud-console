# Dev log — 2026-08-10: real instance deletion, capacity-reservation leak, SSH lockout fix

## Real instance deletion — closing a gap flagged since Phase 2

Built the first real `deleteInstance`: the Server Action marks
`instances.state = 'deleting'` via a new SECURITY DEFINER RPC
(`request_instance_deletion` — needed because `instances` has no UPDATE
RLS policy for regular users, only SELECT and the worker's own
service-role policy; a plain `.update()` silently matched zero rows and
looked like it worked while doing nothing). The site worker's new
`processPendingInstanceDeletions()` picks up `deleting` rows, stops and
destroys the real Proxmox VM, deletes the real Tailscale device
(best-effort), then removes the row.

**Verified live, twice, through the real console UI** (not a DB insert):
created a real instance, clicked the new Delete button, confirmed
`state` flips to `deleting` immediately, and — once the live worker had
the ported fix — confirmed independently that the Proxmox VM's config
file was gone (`404`) and the Tailscale device disappeared from
`list_devices`, not just that the DB row vanished.

## Real bug found chasing the first delete test: capacity_reservations never released

A reservation created for a `ready` (fully successful) operation stayed
`held` for its full 15-minute expiry, double-counting capacity that
Proxmox's own live memory stats already reflected (the VM is real and
running) — causing a spurious `preflight failed` on an unrelated,
genuinely-fits request. Fixed: both the `ready` and the failure path now
set the reservation to `released` immediately, since Proxmox's live
`nodes/{node}/status` memory figure already accounts for real usage the
moment a VM exists — the reservation only ever needed to cover the
window *before* that.

## Real bug found from a user report: SSH lockout with zero registered keys

A user asked "what's the password" trying to SSH into a real instance.
Root cause: the org had zero registered SSH keys, and the instance was
created with "password SSH" left at its default (off). The worker's
`template_cloud_init` stage unconditionally sets a real Proxmox
`cipassword`, but only stores it in Vault (making it retrievable) when
`password_ssh_enabled` is true — so the instance had a real password that
nobody, including GuildCloud, could ever retrieve, and no SSH key was
injected either. A guaranteed, silent lockout.

**Immediate fix for the affected instance:** reset the `guildvm` account's
password directly via the Proxmox guest agent (confirmed
`PasswordAuthentication yes` is actually active first, since Ubuntu cloud
images sometimes override this) and gave the user a real, working
password to log in and change.

**Systemic fix, so this can't happen again:**
- `app/console/instances/new/page.tsx` now fetches the org's real SSH key
  count and passes it to the wizard.
- `create-instance-wizard.tsx`: when the org has zero keys, the "SSH
  keys" block honestly shows "None registered" instead of the previously
  misleading "Always on" (a real honest-copy bug — it claimed something
  that wasn't true), links to Settings to add one, and the "password SSH"
  checkbox is forced checked and disabled (can't be turned off) — verified
  live in the browser both ways: checkbox is `checked: true, disabled:
  true` with zero keys, and `checked: false, disabled: false` again once
  a key exists.
- `createInstance` re-validates server-side (same discipline as the
  existing template-lookup re-check): zero keys + `passwordSsh: false` is
  rejected with a clear error, so no client can bypass the wizard's own
  guard into creating an unreachable instance.
- Instance detail page's Connect card now tells the user to run `passwd`
  after logging in with a revealed password, and links to Settings to add
  a key for next time.

## Also fixed this pass

Instance detail page's real branch (Phase 2/3 instances) previously had
no Delete button at all (only the all-mock branch did) and a stale
"private networking... out of scope" note left over from before Phase 3
existed. Now shows a real Connect card (SSH command, private
hostname/IP) once enrolled, and `OperationProgress` got a real animated
percentage bar plus a spinner on the active stage instead of a plain
static badge list.

## Still outstanding

- Two leftover Tailscale devices from earlier test runs need manual
  deletion (device-delete needs an admin risk level this session doesn't
  have).
- Original exposed key revocation, Supabase service-role key rotation —
  still the user's own action items from earlier in this project.
