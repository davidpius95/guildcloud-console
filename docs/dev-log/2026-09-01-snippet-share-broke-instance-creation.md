# The snippet share broke instance creation on both clusters

**Date:** 2026-09-01
**Trigger:** a plain end-to-end test — create an instance through the real
console UI on `cloud.guild-technologies.com` and watch it reach `ready`.

It failed twice before it worked. Two stacked infrastructure faults, neither
alerted, both silently failing every customer create since **2026-08-29 16:01**.
Instance creation now works: verified twice, `ready` in 69s and 63s.

## What the UI did

The console behaved correctly throughout, which is the part that was under test:

- The create wizard offered only `Lagos 1` (the one real site), only images with
  a tested template there, and kept submit disabled until step 5 had a name.
- Submit landed a real `instance.create` operation, redirected to the detail
  page, and the live build flow advanced through real worker stages.
- On failure it surfaced the **real** worker error rather than a generic
  message, and moved the instance to `failed` instead of spinning forever.
- Delete has a type-the-name confirmation whose button stays disabled until the
  text matches exactly (verified: a doubled value kept it disabled). Teardown
  destroyed the real Proxmox VM *and* removed the instance row.

No console bug was found. Both faults were below it.

## Fault 1 — the worker could not write the snippet directory

```
Unknown system error -116: ... open '/mnt/guild-snippets/guildcloud-102.yaml'
```

`-116` is `ESTALE`. Guild-B returned `Stale file handle` for every operation on
`/mnt/guild-snippets`, including `ls`. Guild-A failed *differently* — `EACCES` —
and that difference identified the cause. Server-side on `guild-pbs`:

```
drwxrwxrwx 3 65534 65534  /srv/guild-snippets          <- parent, world-writable
drwxr-xr-x 2     0     0  /srv/guild-snippets/snippets <- 755 root:root, Aug 29 16:01
```

The export is `no_root_squash`, so this looks fine. It is not: both site workers
are **unprivileged LXC containers**, so container uid 0 maps to host uid 100000,
which is not uid 0 on the wire and never gets the `no_root_squash` exemption.
Against a `755 root:root` directory they fall through to the "other" bits and
get read-only. The parent worked only because it happened to be `777`.
(Confirmed afterwards: the file the failing create left behind is owned by uid
`100000`.)

`Aug 29 16:01` matches the snippet cleanup in
`2026-08-29-task-7-boundary-and-two-production-faults.md`. That cleanup removed
the *directory* rather than only its contents, and it came back root-owned with
default perms. The recreation also gave it a **new inode**, which is the
`ESTALE` on Guild-B: Guild-B bind-mounts the `snippets` subdirectory directly
(`mp0: /mnt/pve/guild-snippets/snippets`), so its bind pinned the dead inode.
Guild-A mounts the parent and appends `snippets`, so it re-resolved the path and
degraded to a permission error instead.

One deletion, two symptoms, two clusters, zero alerts.

**Fixed:** `chmod 1777 /srv/guild-snippets/snippets` — matching the parent's
existing mode, with the sticky bit so one worker cannot delete another's
snippets. Guild-B's worker container was rebooted to re-establish its bind
mount. Both verified by write probe.

## Fault 2 — the backing disk was full

With permissions repaired, the next create got further and died on:

```
ENOSPC: no space left on device, close
```

`guild-pbs` root filesystem was 197G with **0 bytes free**. The PBS datastore
`/mnt/datastore/guild-a` was 188G of it, sharing the filesystem with the
`guild-snippets` and `guild-templates` NFS exports.

### A wrong diagnosis, recorded because it was nearly acted on

The first read of this was: the datastore comment says "7-day retention",
`/etc/proxmox-backup/prune.cfg` is empty and `datastore.cfg` has no `keep-*`
options, therefore no prune job exists and retention was never enforced. That
was **wrong**, and acting on it would have meant deleting backups for no reason.

Retention is enforced on the **PVE** side, which is where it normally lives:

```
guild-a-standard-daily: prune-backups { keep-daily: 7 }, schedule 02:00
```

and PBS garbage collection runs daily with `last-run-state: OK`, having freed
4.4 GB on its last pass. Both mechanisms were working. Two further things make
a prune job the wrong lever here:

- PBS `keep-daily N` means "the N most recent days *that have backups*", not
  "the last N calendar days". Every group already sat at ≤8 snapshots across ≤8
  distinct days, so a PBS-side job with the same policy is close to a no-op.
- The datastore holds `disk-bytes 192,971,087,549` (~180 GiB) against
  `index-data-bytes 7,503,115,518,918` (~6.8 TiB) — a ~39× dedup ratio. The
  space is real backup data, not garbage.

The disk was simply undersized for the workload.

**Fixed, non-destructively:** grew `guild-pbs` scsi0 from 200G to 300G on
nodeC's `local-lvm` (153 GB free at the time), then `growpart` + `resize2fs`
online. Result `296G / 193G used / 98G free`, no backup deleted.

## Verified working

Two full creates through the production UI after the fixes:

| Instance | Node | VMID | Result | Time |
| --- | --- | --- | --- | --- |
| `e2e-01sep-c` | guild-b / podB | 108 | `ready`, 10/10 | 69s |
| `e2e-final-01sep` | guild-b / podC | 109 | `ready`, 10/10 | 63s |

Both got a real Tailscale device, private hostname and project IP — e.g.
`instance-42d5c1f5.tail345216.ts.net` / `100.100.96.76`, online in the tailnet
and carrying the correct scoping tags (`tag:guildcloud-tenant`,
`tag:guildcloud-tenant-project-b44c4107`). VM 108 was confirmed `running` on
podB with the guest agent responding. Both were deleted afterwards through the
real UI teardown flow.

Placement also landed them on two different nodes (podB, podC), which retires
the earlier suspicion that scoring always picked podF.

## Attempted and rolled back: decoupling the snippets share

The PBS datastore sharing a filesystem with the NFS exports is why a backup
volume filling up stopped provisioning. Moving `/srv/guild-snippets` onto its
own 8G volume was attempted and **rolled back**, because it cannot be done from
the storage server alone:

changing the underlying filesystem changes the NFS file handles, so every client
goes `ESTALE` at once. PVE then refuses to remount (`unable to activate storage
'guild-snippets' - directory '/mnt/pve/guild-snippets' does not exist or is
unreachable`) because the stale mount still occupies the mountpoint, and
toggling the storage disable flag does not clear it. Recovering needs
`umount -f -l /mnt/pve/guild-snippets` on **all 11 nodes** across both clusters,
which needs host shell access.

Rolling back (unmounting the new volume so the original inodes reappear)
restored every client immediately — nodeD went back to `active: 1` on its own.
The temporary 8G volume was detached and deleted; `guild-pbs` is back to a
single 300G scsi0 plus its pre-existing `unused0`.

**To do this properly** — as scheduled maintenance with host access:

1. Stop both site-worker containers (guild-a nodeD/500, guild-b podD/500).
2. On `guild-pbs`: attach a volume, `mkfs.ext4`, copy `/srv/guild-snippets/.`
   onto it, mount it at `/srv/guild-snippets`, restore `777` on the share root
   and `1777` on `snippets/`, add to `/etc/fstab`, `exportfs -ra`.
3. On every guild-a and guild-b node: `umount -f -l /mnt/pve/guild-snippets`.
4. Re-activate the `guild-snippets` storage on both clusters, confirm
   `active: 1` on every node.
5. Start both worker containers; write-probe each; run one create.

## Still open

1. **The snippets share still lives on the PBS datastore's filesystem.** Until
   the maintenance above runs, a full backup volume is still an instance-
   creation outage.
2. **No alerting on either condition.** Neither `ESTALE` nor a 100%-full backup
   volume raised anything. Both were found by running the flow by hand — the
   fourth consecutive fault in this project found by looking rather than by an
   alert.
3. **Failed creates leave orphan VMs — still happening.** `Hjj` (105) and
   `Hjj-restored` (106) sit on podF from 2026-08-27, and `yut` (102, stopped)
   was added the same day by a create that hit the ENOSPC fault above. The clone
   succeeds, a later stage fails, and nothing rolls the clone back. Teardown
   works, so this is a missing compensating action on create failure, not a
   broken delete. `yut` is not a test artifact of this session and was left in
   place for its owner to remove.
4. **Capacity headroom is now the thing to watch.** 98G free on a datastore that
   grew to 188G since 2026-08-07. Growing the disk bought time, not a policy.
   Worth deciding a real target retention and datastore size rather than
   resizing again at the next outage.
5. **Stale UI string.** The sidebar still reads `Guild-A live · Guild-B
   onboarding` while Guild-B serves every create. Already open under Task 3.
6. During teardown the detail page still renders the "Provisioning in progress /
   Live build flow" panel under the delete banner — cosmetic, but it says the
   opposite of what is happening.
7. A stale `guildcloud-102.yaml` (0 bytes, uid 100000) sits in the snippets
   store from the ENOSPC failure. Harmless, left in place deliberately rather
   than repeating the delete-a-snippet mistake that started this.

## Test artifacts

Four instances were created on production during this test (`e2e-01sep`,
`e2e-01sep-b`, `e2e-01sep-c`, `e2e-final-01sep`). All were torn down through the
real UI delete flow; podF/podB/podC guest lists and the `instances` table were
re-read afterwards and none leaves a trace.
