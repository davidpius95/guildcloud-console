# Dev log — 2026-08-08: Phase 0 final verification before Phase 1

## What was asked

Before starting Phase 1, make sure everything in Phase 0 is actually good
and tested — not just documented as good.

## What was checked

Re-verified live state directly rather than trusting prior session
documentation: cluster status (both clusters), Ceph health, both backup
jobs' configuration, both firewalls' status, PBS capacity, and the full
template set. All of that came back clean and consistent with what was
documented.

## What verification actually caught

Checking *recent scheduled task history* (not just current config) on
Guild-A surfaced something real: the most recent nightly backup job
(2026-08-08 02:00, run automatically, not something this session
triggered) had `status: "job errors"`. Every guest's data transfer had
succeeded; the failure was entirely in the prune step — a permission gap
(`missing Datastore.Modify|Datastore.Prune`) caused by the exact same
PBS token/user privilege-separation behavior already documented once in
the original G-02 setup, but missed on the grant that mattered.

This meant backup retention had never actually been enforced on either
cluster since the mechanism was stood up — backups were being taken
correctly but never pruned to the intended 7-day window, and the job's
`job errors` status had gone unnoticed because nobody had checked an
actual scheduled run's outcome, only the original restore drill (which
tests restore, not the full nightly lifecycle).

## Fix

Granted `DatastorePowerUser` to the underlying `backup@pbs` user (not
just a token) on the datastore — one change, since both clusters'
backup jobs use tokens of that same user. Verified with real `vzdump`
runs on both Guild-A and Guild-B afterward: both completed `TASK OK`
with the prune step succeeding, not assumed from the permission grant
alone.

## What changed

- Live: one ACL grant (`backup@pbs` user → `DatastorePowerUser` on
  `/datastore/guild-a-standard`).
- `docs/decisions/2026-08-08-backup-prune-permission-fix.md` — full
  record.
- `docs/phase-0/gap-register.md` — G-02 updated with the real finding
  and fix, not just re-stamped as "still resolved."

## Why this matters

This is the exact value of "test and verify" as a distinct step from
"read the docs and confirm they say it's done." The original restore
drill was real, valid evidence — it just didn't cover this failure mode.
Worth remembering for future verification passes: check what actually
happened on the most recent real run, not just whether the mechanism
exists in config.

## Phase 0 status: verified good

With this fix in place, Phase 0's infrastructure work (Guild-A + Guild-B:
firewall, backups, templates, monitoring correction, SDN validation,
security audits) is in a genuinely verified-working state, not just a
documented one. Moving to Phase 1 (control plane) next.
