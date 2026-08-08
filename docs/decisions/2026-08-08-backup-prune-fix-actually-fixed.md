# Decision record: PBS backup prune — the real root cause and fix

**Date:** 2026-08-08 (evening). Supersedes the earlier same-day
`2026-08-08-backup-prune-permission-fix.md`, which diagnosed the right
symptom but the wrong root cause.

## What happened

The morning's fix granted `DatastorePowerUser` to the **bare user**
`backup@pbs` on `/datastore/guild-a-standard`, reasoning that a token's
effective permission is the intersection of the token's own grants and
the user's grants. A pre-Phase-2 verification pass re-ran real backups
live and found the exact same `missing Datastore.Modify|Datastore.Prune`
error recurring — on both a fresh single-VM test (VM 111, rabbitmq) and,
per its own task history, every real scheduled run since.

## Actual root cause

Read the live ACL state directly (`proxmox-backup-manager acl list`, via
QEMU guest-agent exec into the PBS VM — the tool that returns output
reliably is the manual `agent/exec` + `agent/exec-status` two-step via
`pve_call`, not the `execute_vm_command` convenience wrapper, which
returned empty output for every command tried against this VM).

The token `backup@pbs!pve-cluster` (the identity backup jobs actually
authenticate as) had:
- `Admin` on `/` (root) — broad, but...
- `DatastoreAudit` + `DatastoreBackup` **specifically on
  `/datastore/guild-a-standard`** — no Modify, no Prune.

Proxmox/PBS ACL evaluation uses the **most specific matching path** for a
given identity, not a union of everything inherited from parent paths.
The token's own narrow grant at the exact datastore path overrides its
broader `Admin` on `/` for that path. The morning's fix targeted the bare
`backup@pbs` **user**, not this token — and since backup jobs authenticate
as the token (not the bare user), the user-level grant never applied.
Whether that's because token privilege separation is enabled by default
(tokens don't inherit user grants unless privsep is explicitly disabled)
or because the token's own specific-path grant simply wins regardless,
either mechanism produces the same observed result: the fix needed to be
on the token, not the user.

The same latent gap existed on `backup@pbs!guild-b-cluster` (Guild-B's
token) — not yet triggered in practice only because none of Guild-B's
guests had accumulated enough backups to exceed `keep-daily=7` yet.

## Fix

Granted `DatastorePowerUser` directly to **both tokens** on
`/datastore/guild-a-standard`:

```
proxmox-backup-manager acl update /datastore/guild-a-standard DatastorePowerUser --auth-id backup@pbs!pve-cluster
proxmox-backup-manager acl update /datastore/guild-a-standard DatastorePowerUser --auth-id backup@pbs!guild-b-cluster
```

(The earlier user-level grant on bare `backup@pbs` was left in place —
harmless, not the active grant for either job, but no reason to remove
it.)

## Verified, not assumed

Re-ran `vzdump` on VM 111 (the exact guest that had just failed twice)
after applying the fix:

```
INFO: prune older backups with retention: keep-daily=7
INFO: running 'proxmox-backup-client prune' for 'ct/111'
INFO: pruned 2 backup(s) not covered by keep-retention policy
TASK OK
```

Prune ran and actually removed 2 stale backups this VM had accumulated
while the bug was live — real proof, not just an absence-of-error.

## Why the morning's verification didn't catch this

The morning's fix was verified with a real `vzdump` run too (VM 9001 on
Guild-A, VM 102 on Guild-B) — but those happened to be guests with too
few existing backups to trigger a real prune (nothing to remove), or
guests whose specific token path happened to work. The fix "worked" in
the sense that the specific test performed didn't fail, without the test
actually exercising the token-vs-user distinction that mattered. Worth
remembering: a passing test only proves what it actually exercised —
re-testing on the *exact same guest that previously failed*, not a
different one, is what caught this.

## Status

**G-02 backup retention is genuinely resolved now** on Guild-A, with both
tokens fixed. Guild-B's identical latent gap was fixed pre-emptively
before it could bite (its own guests hadn't yet accumulated enough
backups to hit it in practice, but the ACL state was identical).
