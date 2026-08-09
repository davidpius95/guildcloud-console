# Dev log — 2026-08-09: worker loops internally, real provisioning-speed fix

## What was asked

A real user submission through the actual console UI sat at
`operation_created` (a no-op administrative stage) for what looked like a
stuck operation. Investigated live rather than assumed: the operation
wasn't stuck, it had already reached `ready` — but the whole pipeline took
**~8.5 minutes** end-to-end, almost entirely dead time.

## Root cause

The worker (`/opt/guildcloud-worker/index.js` on the Guild-A LXC) did
exactly one stage per systemd-timer tick, and the 20s `OnUnitActiveSec`
only starts counting after the *previous* run finishes — so even stages
with nothing to wait on (four purely administrative stages: `preflight`
through `site_worker_dispatch`) still paid the full external tick cadence
between each one. Across 10 stages that adds up to minutes of pure
"waiting for the next check," on top of real infrastructure wait time.

## Fix

Refactored the worker (both the Node.js on-network script and the kept-in-
sync Deno source) to loop internally: one process invocation now advances
through as many stages — and even multiple queued operations — as it can
within a ~150s budget, stopping only when there's genuinely nothing left
to do or a stage needs to wait on real infrastructure (currently just
`automated_verification`, retried every 4s in-process instead of falling
back to the external 20s timer). Durability is unchanged: state still
commits to Postgres after every single stage, so a crash mid-loop resumes
exactly where it left off, same guarantee as before — this was purely a
latency fix, not a change to the retry-safety model.

Also raised the systemd service's `TimeoutStartSec` from the 90s default to
300s, since a longer-running loop would otherwise get killed mid-provision
by systemd's own timeout — a real thing that would have silently
undermined the fix if missed.

## Verified live, with real numbers

A timing-verification run (real VM, deleted after):

- `preflight` through `backup_monitoring_attach` (8 stages: 4
  administrative + capacity reservation + real Proxmox clone + real
  cloud-init config/boot): **~24.5 seconds total**, gaps of 1-2s between
  each — down from minutes of pure tick-wait.
- `automated_verification` (waiting for the real guest agent to come up):
  **~2m11s** — this is real guest-OS boot time on this template, not
  something the worker's own timing controls. Slower than typical for a
  lightweight cloud image; worth investigating separately if faster
  provisioning end-to-end matters (template bloat, cloud-init first-boot
  work, guest-agent service start delay are the usual suspects).
- Total: 3m17s, down from ~8.5 minutes — the fix eliminated essentially
  all of the *artificial* delay; what's left is close to the real physical
  floor for "clone a VM and wait for it to boot."

## Not done this pass

Did not investigate why guest-agent readiness takes over 2 minutes on this
specific template — flagged as a separate, real question, not silently
folded into "the worker is now fast."
