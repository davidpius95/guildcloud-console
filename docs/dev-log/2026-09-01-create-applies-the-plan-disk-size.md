# Create now applies the plan's disk size

**Date:** 2026-09-01
**Fixes:** finding 1 of `docs/dev-log/2026-09-01-resize-and-restore-tested.md` —
every instance shipped with the template's 16 GiB boot disk regardless of the
plan bought.

## The bug

`instance.create` applied `cores` and `memory` from `catalog_plans` and never
touched the disk. A clone inherits the template's disk, so a customer on std-8
(320 GB advertised, $0.25/hr) received the same 16 GiB as std-1. Only
`resizeInstanceResources` ever applied `disk_gb`, which is why `yrt` has its full
160 GiB — it was resized after creation — while `Trsy`, created 2026-08-27 and
never resized, still has 16 GiB.

## The fix

New `ensureBootDiskSize()` in `deploy/site-worker/lifecycle.js`, called from both
paths that build a VM:

- **Cold clone** (`index.js`, `template_cloud_init` stage) — after the config PUT
  and **before the first `status/start`**. Ordering is the point: cloud-init's
  growpart/resizefs runs on first boot, so the guest filesystem takes the new
  size itself. Growing after boot would leave the partition short.
- **Warm pool build** (`maintainWarmPool`) — pooled VMs are claimed only for
  their own plan and the claim path never boots them a second time, so the pool
  build is the only chance to get this right.

The helper reuses the existing `resolveBootDisk`/`parseDiskGiB` rather than
re-deriving which disk is the boot disk, and:

- **never shrinks** — returns `grown: false` when the disk already meets the plan,
  so it is safe on re-entry and on any future template with a larger disk;
- **rounds the delta up to whole GiB**, because Proxmox rejects fractional
  deltas and rounding up can only overshoot, never leave the customer short;
- **re-reads the config and fails loudly** if the disk did not actually reach the
  target, rather than trusting the task result — the same "confirm, don't assume"
  rule Task 5 applied to snapshots;
- records the achieved size in the stage detail as `boot_disk_gb`.

Both call sites resolve the plan through `getPlan`, which on the `worker_token`
path is the `worker_get_plan` RPC. That returns `to_jsonb(plan)` — the whole row
— so `disk_gb` is present; verified against the live catalogue rather than
assumed, since `getPlan` ignores its `columns` argument on that path and a
missing field would have turned every create into a hard failure.

## Verification

Four new tests in `lifecycle.test.js` cover the grow, the never-shrink case, a
Proxmox task that reports success without growing the disk, and a plan with no
usable `disk_gb`. Full gate green: `check:migrations`, `lint`, `typecheck`,
`test:worker` (175), `test:ui`, `test:db`, `test:intents`, `test:worker-boundary`,
`build`.

Not yet verified against a live create — this needs the worker deployed (see
below).

## Not done here

1. **Not deployed.** The workers self-deploy from `main` every two minutes
   (`deploy-pull.sh`), so this reaches production only when it lands on `main`.
   Until then every new instance is still created at 16 GiB.
2. **The existing fleet is still undersized.** This fixes new creates only. Every
   instance never resized — `Trsy` among them — still has 16 GiB while being
   billed for its plan. Remediation is awkward: the obvious route is a resize per
   instance, and **resize is currently the operation that strands instances**
   (finding 2 of the resize/restore entry). The resize reboot and the `degraded`
   dead end should be fixed before anyone uses resize to remediate the fleet.
3. The disk grows to the plan size, but nothing yet *verifies* post-boot that the
   guest filesystem actually expanded. `automated_verification` would be the
   natural place for that check.
