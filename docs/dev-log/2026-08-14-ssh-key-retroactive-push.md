# Dev log — Phase 1: retroactive SSH key push, verified

## The fix

`ssh_keys` only ever reached a VM's cloud-init once, at creation
(`template_cloud_init` sets Proxmox's `sshkeys` config param, which only
applies at first boot). Adding or removing an org key later did nothing
for already-running instances — including revocation, the
security-relevant half.

`addSshKey`/`removeSshKey` now call a new `mark_org_instances_ssh_dirty`
RPC that flags every `ready` instance in the org. The worker's new
`processPendingSshKeySyncs` picks up flagged instances and writes the
org's current key set directly into `/home/guildvm/.ssh/authorized_keys`
via `agent/exec`.

## Three real bugs found verifying this, not just one

Live verification caught real problems the code review didn't:

1. **A naive overwrite would have deleted an operator's own baked-in
   key.** The first version just replaced the whole file. Fixed before
   ever running live: a marker-delimited managed block
   (`# BEGIN GUILDCLOUD MANAGED KEYS` / `# END ...`) that only touches
   content between the markers — anything else in the file (an
   operator's manually-added key) is left alone.
2. **`printf '%s\n' "<JSON.stringify'd string>"` left literal
   backslash-n text in the file instead of real newlines.** Double-quoted
   shell strings don't interpret `\n` — only `printf`'s own FORMAT string
   does, not its arguments. First live attempt produced a managed block
   with the whole thing crammed onto one line, backslash-n and all.
   Fixed by base64-encoding the block and decoding it in the guest,
   sidestepping shell quoting entirely instead of fighting it.
3. **Verification itself was checking the wrong VM.** Early checks in
   this same pass used a stale `proxmox_vmid` (`781555`) from earlier
   context instead of querying `podTesting`'s real one (`511670`) — every
   "it's not landing" result until that point was actually just looking
   at the wrong host. A large gap in the session (real time jumped from
   2026-08-10 to 2026-08-14 mid-verification) made it easy to trust
   remembered state instead of re-querying it. Fixed by pulling
   `instances.proxmox_vmid` fresh via SQL before trusting any identifier
   again.

## Verified live, for real, both directions

- Added a real throwaway SSH key via the actual Settings UI → confirmed
  `ssh_keys_sync_pending` flipped true then false within one worker cycle
  (worker runs every ~20-60s) → independently confirmed via `agent/exec
  cat authorized_keys` (not just trusting the flag) that the key actually
  landed in the guest, with real newlines, alongside the untouched
  operator key.
- Removed the key via the actual Settings UI → confirmed the flag cycled
  again → confirmed via `agent/exec` that the managed block is now empty
  and the operator's own key is still present, untouched.

## Not yet done

Real second-session negative-access test (a non-Owner/Admin session
attempting the RPC directly) wasn't run this pass — RLS/authorization on
`mark_org_instances_ssh_dirty` was reviewed by reading the policy
definition, not exercised live. Worth a real check before this is
considered fully hardened.
