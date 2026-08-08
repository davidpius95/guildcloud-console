# Dev log — 2026-08-08: PBS prune permission regression found live, during pre-Phase-2 verification

## What was asked

User asked to test everything from prior phases before starting Phase 2.
Re-checked Guild-A's most recent scheduled backup task history as part of
that pass (same check that originally caught this class of bug).

## What was found

The most recent scheduled nightly job (2026-08-08 02:00) had
`status: "job errors"` again — the exact same failure documented as fixed
earlier today in `docs/decisions/2026-08-08-backup-prune-permission-fix.md`:

```
ERROR: prune 'ct/110': proxmox-backup-client failed: Error: permission
check failed - missing Datastore.Modify|Datastore.Prune on
/datastore/guild-a-standard
```

This alone could have been a stale pre-fix log entry (the fix's own
verification was also dated 2026-08-08, so ordering was ambiguous from
history alone). Rather than assume either way, ran real, fresh `vzdump`
backups live to check current behavior directly:

- **VM 110 (jellyfin, nodeA)**, run at 18:47: `TASK OK`, backup job
  finished successfully. No prune step even appears in the log — jumps
  straight from upload completion to "Backup job finished successfully."
- **VM 111 (rabbitmq, nodeB)**, run ~11 minutes later at 18:58: **`TASK
  ERROR: job errors`** — prune explicitly attempted and failed with the
  identical `missing Datastore.Modify|Datastore.Prune` error.

Both guests have a comparable number of existing backups (2 each, well
under the `keep-daily=7` retention), both target the same
`/datastore/guild-a-standard` path, both use the same
`backup@pbs!pve-cluster` token. Why one attempted+failed the prune step
and the other didn't attempt it at all is not something I could resolve
with available tooling — but the VM 111 failure is unambiguous, live, and
current: **the prune permission gap is not reliably fixed**, contradicting
this morning's "fixed and verified" status.

## What I could not do

Wanted to directly inspect `backup@pbs`'s current ACL grants on the PBS
server itself (VM 400, `guild-pbs`) to see whether the earlier
`proxmox-backup-manager acl update ... DatastorePowerUser --auth-id
backup@pbs` grant is actually still present. The `execute_vm_command` tool
(QEMU guest-agent exec) returned `success: true, exit_code: 0` but
**empty output for every command tried**, including trivial ones
(`whoami`, `id`, `echo hello-test-123`) — confirmed broken for this VM in
this session, not a permissions issue on my end. No other tool in this
session reaches PBS's own REST/ACL API (Proxmox VE's `pve_call` only
reaches the PVE cluster API, not PBS, which is a separate product on a
different port).

Also attempted a closer reproduction of the original failing job's exact
shape (`vzdump --all 1 ...`, matching the scheduled job) to test more
guests at once — correctly blocked by the session's own safety guardrail
as a broader-blast-radius production action. Did not attempt to route
around this; a full-cluster backup run is a reasonable thing to gate.

## What should happen next (needs direct PBS shell or dashboard access)

Someone with direct access to the PBS server should:

1. Confirm current grants: `proxmox-backup-manager acl list` (or the PBS
   web UI's Access Control panel) for `/datastore/guild-a-standard`.
2. If `backup@pbs`'s `DatastorePowerUser` grant is missing or reverted,
   re-apply it: `proxmox-backup-manager acl update
   /datastore/guild-a-standard DatastorePowerUser --auth-id backup@pbs`.
3. Check whether anything could be silently reverting this grant (a
   config-management process, a PBS upgrade resetting ACLs, manual
   intervention) — if this keeps recurring, the grant alone isn't a
   durable fix and needs a "why does this keep coming back" answer, not
   just a re-application.
4. Re-check Guild-B's job too — it uses a token of the same underlying
   `backup@pbs` user, so the same regression likely affects it.

## Status

**G-02 (backup retention) is reopened, not resolved.** Backup data
transfer itself is still working correctly on both clusters (confirmed
again in these same test runs) — only the prune/retention step is
affected, meaning old backups continue accumulating past the intended
7-day window rather than being silently lost. Not a data-loss risk, but a
real, currently-broken commitment (§8: encrypted backup with defined
retention) that was reported fixed and isn't.
