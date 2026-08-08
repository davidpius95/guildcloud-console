# Decision record: fix silent backup prune failures (both clusters)

**Date:** 2026-08-08
**Status:** fixed and verified with real test runs on both clusters.

## Context

Before starting Phase 1, did a full re-verification pass over Phase 0's
live state rather than trusting prior documentation. Checking recent
`vzdump` task history on Guild-A surfaced something no one had caught:
the most recent scheduled nightly backup (2026-08-08 02:00, run
automatically, not triggered by this session) had `status: "job errors"`.

## What was actually wrong

Every guest's backup **data transfer succeeded cleanly** — the failure
was entirely in the post-backup **prune** step:

```
ERROR: prune 'vm/300': proxmox-backup-client failed: Error: permission
check failed - missing Datastore.Modify|Datastore.Prune on
/datastore/guild-a-standard
```

This happened for every guest in the job (VM 300, 9000, 9001), each
one failing the exact same way, which is why the whole job reported
`job errors` despite the underlying backups being genuinely fine.

## Root cause — the same gotcha already documented once, missed again

This is the exact privilege-separation behavior already written up in the
original PBS setup (`docs/decisions/2026-08-07-backup-architecture.md`):
a PBS token's effective permission is the **intersection** of the token's
own ACL grants and its owning user's grants, not the token's grants alone.

`backup@pbs!pve-cluster` (the token Guild-A's daily job actually uses,
configured directly in the storage's `username` field) has `Admin` on `/`
at the token level — but the underlying user `backup@pbs` only ever had
`DatastoreBackup` + `DatastoreAudit` granted directly. The intersection of
"Admin" and "Backup+Audit" is "Backup+Audit" — no prune capability, no
matter how broad the token's own grant looks.

The same gap affected `backup@pbs!guild-b-cluster` (created earlier today
for Guild-B's job) for the identical reason — it's also a token of the
same underlying `backup@pbs` user.

**This means retention has never actually been enforced on either
cluster's backups** since the mechanism was first stood up on 2026-08-07 —
old backups have been accumulating, not being pruned to the intended
7-day window, silently, because nobody had inspected a scheduled run's
actual outcome until this verification pass.

## Fix

Granted `DatastorePowerUser` (includes prune) to the underlying `backup@pbs`
**user** — not another token — on `/datastore/guild-a-standard`:

```
proxmox-backup-manager acl update /datastore/guild-a-standard DatastorePowerUser --auth-id backup@pbs
```

One change to the user fixes the intersection for every token of that
user — both clusters' jobs use tokens of the same `backup@pbs` user, so
this single grant covers both.

## Verified, not assumed

Ran a real `vzdump` (not a dry run) on both clusters after the fix:

- **Guild-A** (VM 9001, Debian template): `Backup job finished
  successfully`, `TASK OK` — prune step completed with no permission
  error (previously failed every time).
- **Guild-B** (VM 102, test VM): `Backup job finished successfully`,
  `TASK OK` — same confirmation.

## What changed

- Live: `backup@pbs` user granted `DatastorePowerUser` on
  `/datastore/guild-a-standard`.
- No guest, VM, or backup data was touched — this was a permissions-only
  fix. No backups were lost; they just weren't being pruned.

## Why this matters for the "is Phase 0 actually done" question

The original G-02 decision record's restore drill proved backups could
be *restored* — real, valid evidence. It did not catch that the *ongoing
scheduled* job had a permission gap in a step that only runs after backup
data transfer completes, because a restore drill tests restore, not the
job's full nightly lifecycle including retention. This is exactly the
kind of gap a "read the docs and confirm" pass would miss and a "check
the actual recent task history" pass catches — worth remembering for any
future "is this really working" verification.
