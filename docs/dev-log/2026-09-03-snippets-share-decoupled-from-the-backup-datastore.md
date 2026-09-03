# The snippets share now has its own filesystem, and podG joined the tailnet

**Date:** 2026-09-03
**Trigger:** two customer `instance.create` operations failed on guild-b, both
at `template_cloud_init`, both with `ENOSPC: no space left on device, close`.

This is the recurrence that
`2026-09-01-snippet-share-broke-instance-creation.md` predicted in its "Still
open" item 1:

> The snippets share still lives on the PBS datastore's filesystem. Until the
> maintenance above runs, a full backup volume is still an instance-creation
> outage.

It took two days. The scheduled maintenance that entry specified has now been
carried out, so this specific outage cannot recur.

## What failed

| Operation | Node | Stage | `failure_reason` |
| --- | --- | --- | --- |
| `d614c699` | podD | `template_cloud_init` | `ENOSPC: no space left on device, close` |
| `2486411c` | podD | `template_cloud_init` | `ENOSPC: no space left on device, close` |

`guild-pbs` root was `296G / 289G used / 0 free`. `/mnt/datastore` (PBS chunks)
was 285G of it, sharing `/dev/sda3` with the `guild-snippets` and
`guild-templates` NFS exports. `writeSnippet()` is a plain `fs.writeFileSync`
onto that share, so a full backup volume is a hard stop on every create.

## The wrong diagnosis, reached a second time

The first read was again "the datastore says 7-day retention, `prune.cfg` is
empty, therefore retention was never enforced". The 2026-09-01 entry already
records this as **wrong**, and it was wrong again. Confirmed independently
before acting:

- No backup group holds more than **8** snapshots (mode 7) across 295
  snapshots in 62 groups. `keep-daily=14` — or even 7 — is close to a no-op.
- The 27-day *span* is different VMs backed up at different times, not any
  group hoarding history. Per-group retention is working, on the PVE side.

**No backups were pruned or deleted.** The user had approved a 14-day prune
before this was established; it was not carried out because it would have
destroyed history for no space gain. That decision is worth keeping: the next
person to see "no prune job" will reach for it a third time.

## What actually reclaimed the space

GC was running daily and healthy, but held **94 GB** in `pending-bytes` behind
the 24-hour `gc-atime-cutoff` grace. With no backup task running, the cutoff
was lowered temporarily, GC re-run, and the default restored:

```
proxmox-backup-manager datastore update guild-a-standard --tuning gc-atime-cutoff=5,gc-atime-safety-check=1
proxmox-backup-manager garbage-collection start guild-a-standard
proxmox-backup-manager datastore update guild-a-standard --delete tuning
```

`gc-atime-safety-check` was deliberately left **on**. Result: 25,974 chunks
removed, `289G used` → `201G used`, 100% → 70%. No snapshot was deleted.

## The decoupling (the maintenance from 2026-09-01, now done)

`/srv/guild-snippets` is now a dedicated 4 GB ext4 filesystem on a loopback
image, so the PBS datastore can fill `/` completely without touching it.

The 2026-09-01 attempt was rolled back because changing the backing filesystem
`ESTALE`s every client and recovery needs host shell on all 11 nodes. That
access was available this time, so the documented five-step plan ran to
completion:

1. `fallocate` + `mkfs.ext4` a 4 GB image, staged the existing content onto it,
   mounted it at `/srv/guild-snippets`, restored `777` on the share root and
   **`1777` on `snippets/`** — the sticky mode from the 2026-09-01 fix, which
   matters because both workers are unprivileged LXCs whose uid 0 maps to
   100000 on the wire and never gets the `no_root_squash` exemption.
2. Added `loop,nofail` to `/etc/fstab`.
3. Pinned **`fsid=101`** on the export. The 2026-09-01 attempt had no fixed
   fsid, which is part of why every handle went stale; pinning it means a
   future backing-store change does not repeat this.
4. `umount -f -l /mnt/pve/guild-snippets` on all 11 nodes (podA-podF,
   nodeA-nodeE), then remount + write probe on each. All 11 returned OK.
5. Rebooted both worker LXCs (guild-b podD/500, guild-a nodeD/500) to
   re-establish their bind mounts. Guild-B bind-mounts the `snippets`
   subdirectory (`mp0: /mnt/pve/guild-snippets/snippets`) so it pins an inode
   and *must* be restarted; guild-a mounts the parent. Both write-probed OK.

Sizing note: the volume is 4 GB for a directory that holds kilobytes. It has to
clear the preflight's own `>= 1 GiB free` floor — a first attempt at 512 MB
passed every write probe and still blocked every create, which is what surfaced
the message bug below.

## Console changes

**A false alarm worth recording.** The working branch was stale, and against it
`can_provision_instance` appeared to exist only in the live database with no
migration behind it — which would have meant a rebuilt control plane had no
shared-storage gate at all. That was wrong. PR #78
(`20260903100000_admission_checks_snippets_storage.sql`) had already landed on
`main` and adds both the `snippets_storage_id` column and the gate. Fetch before
concluding the database has drifted.

**The gate's message named the wrong cause.** This part is real, and survives
#78. The gate requires `>= 1 GiB free` AND `>= 5% free` but only ever reported
percentage full, so a healthy-but-small volume was reported as `is 0.0% full` —
true, and useless. `20260903120000_name_which_shared_storage_limit_was_hit.sql`
changes only the message; the eligibility arithmetic is byte-identical to #78's.
The two conditions now produce two sentences:

| Condition | Message |
| --- | --- |
| below the 1 GiB floor | `has only 487.3 MB free, and every new server needs at least 1 GB there to be prepared` |
| genuinely full | `is 98.3% full, and every new server needs to write there first` |

**Raw worker errnos no longer reach the customer.** New
`deploy/site-worker/failure-messages.js` maps `ENOSPC`, `ESTALE`, `EACCES`,
Proxmox 4xx/5xx and network faults to a cause and a "yours to fix / ours to
fix" signal. The raw text is still written to the stage, which is what an
operator reads — only the customer-facing `failure_reason` is rewritten. The
motivating string is now a test case.

## Verified working

One full create through the production RPC after the fixes:

| Instance | Cluster / node | VMID | Result |
| --- | --- | --- | --- |
| `verify-fix-probe` | guild-b / podC | 105 | `succeeded`, stage `ready` |

Got a real Tailscale device (`instance-5b7f62f6`, `100.93.146.105`), answered
`tailscale ping` in 7 ms, and `qm status` showed `running`. Deleted afterwards
through `request_instance_deletion`; the operation succeeded and the instance
row is gone.

Gate: `typecheck` clean, `lint` clean, `check:migrations` passed, `build`
succeeded, `test:worker` 198/198, `test:ui` 21/21.

## podG

A new node, `podG` (192.168.8.198), was brought up and joined the tailnet as
`podg` / `100.79.95.124` with `tag:guildcloud-mgmt` and Tailscale SSH, matching
podF. It was pointed at the **enterprise** Proxmox and Ceph repos with no
subscription, so `apt update` returned 401 and 145 updates had never been
applied; switched to `pve-no-subscription` + `ceph-no-subscription` (enterprise
files set `Enabled: false`), upgraded 9.2.2 → 9.2.11, kernel 7.0.2-6 →
7.0.14-15, rebooted. Tailscale was in the apt sources but the package had never
been installed. Wazuh agent installed to match podD/podF, enrolled as agent
`038`.

**podG is standalone.** podA-podF form the quorate 6-node `Guild-B` cluster;
podG is not in it. Left that way deliberately pending a decision.

## Still open

1. **No alerting, still.** A 100%-full backup volume took the platform's
   provisioning offline for the second time in three days and raised nothing
   both times. Every fault in this project so far has been found by looking.
   This is now the highest-value missing piece.
2. **No scheduled PBS prune job.** Deliberately not added — see above, it is
   not the lever. But retention is enforced only on the PVE side, so if that
   job is ever removed the datastore grows unbounded with nothing on the PBS
   side to stop it.
3. **Capacity is still the thing to watch.** 86G free of 296G after GC. The
   datastore holds ~195 GiB of real, deduplicated backup data (39× ratio). This
   bought headroom, not a policy — the 2026-09-01 entry said the same thing and
   the disk filled again anyway.
4. **`guild-templates` is still on the PBS filesystem.** Only snippets were
   decoupled. Templates are read-mostly so a full disk does not break cloning,
   but building a new template would fail the same way.
5. **The worker change is not deployed.** `deploy-pull.sh` polls `main` every
   two minutes, so `failure-messages.js` reaches both workers only on commit +
   push. Until then the console still shows raw errnos on failure.
