# Guild-B shared-storage inventory and proposed migration scope

Date: 2026-08-26, approximately 08:27 UTC.
Status: inventory complete; approved podF VM119/121 migration completed at
approximately 08:42 UTC. New-node provisioning activation remains pending.

## Scope and exclusions

The user requested continuation with podA excluded. During the inventory,
no podA-specific calls were made and no VM, disk, template, backup, storage
configuration, scheduler setting or database row was changed. The subsequent
approved migration is recorded separately below.

Inspection used Guild-B storage/configuration reads through podC–podF,
plus read-only diagnostics inside the separate Guild-A PBS VM. Shared
storage listings include the existing podA base disk; it is excluded from
all proposed moves and deletions. No backup retention or garbage collection
was run. The local report is the only file created by this inspection.

## Actual storage layout

`guild-pbs` is Guild-A VM 400 on nodeC, confirmed inside the guest as
192.168.8.126. Its 200 GiB virtual disk is `local-lvm:vm-400-disk-0`.
Its ext4 root filesystem `/dev/sda3` backs all three paths:

| Path | Role | Allocated GiB measured with du |
| --- | --- | ---: |
| `/mnt/datastore/guild-a` | PBS datastore `guild-a-standard` | 166.47 |
| `/srv/guild-templates` | Shared VM disks and Ubuntu base template | 20.15 |
| `/srv/guild-snippets` | Shared cloud-init files | 0.00003 |

The filesystem reported 196.66 GiB total and 188.49 GiB used, with zero
available bytes in the df/Proxmox status samples. Filesystem reservations
mean total minus used is not all available to services. Other filesystem
usage accounts for approximately 1.87 GiB. Values are time-specific and
may change with backups and guest activity.

The large consumer is PBS, not snippets. Backup data is deduplicated;
snapshot logical sizes must not be summed to estimate reclaimable space.
The Guild-B backup namespace exposed 69 snapshots. No candidate VM below
had a snapshot in that namespace listing; this does not rule out backups
elsewhere. Do not prune the shared datastore as part of this VM migration.

## Candidate disks outside podA

All 14 VMs below were stopped, had no configured lock, and had no Proxmox
snapshots beyond the API's `current` marker. Each has a 16 GiB virtual
`scsi0` disk and a small `ide2` cloud-init disk on `guild-templates`.
Reclaim estimates use Proxmox content `used` bytes for both volumes, not
their virtual capacities. Space is recovered only after successful copy
verification and removal of the old source volumes.

| Node | VMID | Name | Disk relationship | Estimated source GiB |
| --- | ---: | --- | --- | ---: |
| podC | 116 | ui-test-guild-b-vm | Linked to base 9100 | 0.0028 |
| podD | 113 | ui-test-guild-b-vm | Linked to base 9100 | 1.2836 |
| podD | 117 | ui-test-guild-b-vm | Linked to base 9100 | 0.0028 |
| podE | 105 | ui-test-guild-b-vm | Linked to base 9100 | 1.2722 |
| podE | 109 | ui-test-guild-a-vm | Linked to base 9100 | 1.2776 |
| podE | 111 | ui-test-guild-a-vm | Linked to base 9100 | 1.4618 |
| podE | 114 | ui-test-guild-b-vm | Linked to base 9100 | 0.0128 |
| podF | 106 | ui-test-guild-a-vm | Linked to base 9100 | 1.3257 |
| podF | 107 | ui-test-guild-b-vm | Linked to base 9100 | 0.0028 |
| podF | 110 | ui-test-guild-a-vm | Linked to base 9100 | 1.3259 |
| podF | 112 | ui-test-guild-b-vm | Linked to base 9100 | 1.2699 |
| podF | 115 | ui-test-guild-a-vm | Linked to base 9100 | 1.3275 |
| podF | 119 | iiiuuu | Independent full disk | 3.1945 |
| podF | 121 | coolify | Independent full disk | 3.1945 |

Total estimated reclaim: **16.95 GiB**. The independent disks on podF
(119 and 121) account for **6.39 GiB**. The twelve linked guests account
for **10.57 GiB**. The shared base itself uses about 3.19 GiB and must
remain unchanged. No listed candidate disk was shown to be orphaned.

| Destination | Free local-lvm GiB | Candidates | Estimated source GiB |
| --- | ---: | ---: | ---: |
| podC | 3556.58 | 1 | 0.003 |
| podD | 1702.26 | 2 | 1.286 |
| podE | 1754.72 | 4 | 4.024 |
| podF | 1710.01 | 7 | 11.641 |

Flattening linked guests would copy their complete visible disk contents
to local storage; destination usage will exceed their small shared delta
sizes. These are migration candidates, not authorization to delete them.

## Console reconciliation

The cluster-scoped Supabase lookup matched VM 105 to a current instance
record. Its database state is `ready` and its `storage_id` is `local-lvm`,
but Proxmox reports it stopped with both volumes on `guild-templates`.
Its recorded create operation succeeded. Resolve this mismatch during any
approved migration; do not delete it based on its test-looking name.

The other 13 VMIDs had no matching current Guild-B instance rows. That is
not proof that they are disposable: their ownership and recovery needs
must be confirmed before any destructive cleanup.

## Proposed next actions, not executed

1. Obtain approval for a first batch restricted to podF VMs 119 and 121.
   Recheck status, locks, dependencies and backup/recovery arrangements;
   copy their disks onto podF local-lvm, verify integrity and configuration,
   then remove only the corresponding old volumes after successful
   verification. Preserve VM identity and do not automatically boot guests
   carrying old cloud-init data. Expected reclaim: about 6.39 GiB.
2. Review the remaining 12 guests and their ownership. Any later migration
   must flatten the guest disks while leaving podA and base template 9100
   unchanged. Check version-specific move behavior before execution.
3. Establish separate local provisioning templates on podC–podF using a
   method consistent with the podA exclusion. Validate clone, disk, guest
   boot, networking and worker access before enabling scheduler targets.
4. Plan a separate PBS capacity change. Moving all candidate VM disks
   would provide temporary headroom, but the backup datastore still needs
   dedicated capacity or a verified expansion plan. Inspect backing-host
   capacity before choosing a new disk size. No backup deletions proposed.

## Evidence and limits

Inventory used explicit `pve_call(cluster="guild-b")` node/storage/config
and snapshot GETs, the current cluster resource inventory, and a
cluster-scoped service-side Supabase SELECT. PBS identity, mounts and
allocated directory sizes were verified through Guild-A nodeC VM400's
guest agent with hostname, ip, df, findmnt, du, lsblk and read-only
tune2fs listing. The convenience guest-exec wrapper timed out; explicit
agent exec/exec-status completed successfully. Direct SSH authentication
was unavailable. No credential values or cloud-init contents were exposed.

During the inventory phase, no disk-copy, restore, guest boot, filesystem
expansion or provisioning test was performed. Node activation remains pending.

## Approved migration execution — 08:31 to 08:42 UTC

The user approved moving only VM119 (`iiiuuu`) and VM121 (`coolify`) to
podF local-lvm, verifying the moves, then removing their old shared copies.
All infrastructure mutations in this batch targeted those two VMs on podF.
PodA, its templates, the other 12 candidate VMs, backups, scheduler admission
and database records were not changed.

| VM | Main disk after move | Cloud-init disk after move | Final state |
| --- | --- | --- | --- |
| 119 | `local-lvm:vm-119-disk-0` (16 GiB) | `local-lvm:vm-119-cloudinit` (4 MiB) | stopped, no lock or unused disks |
| 121 | `local-lvm:vm-121-disk-0` (16 GiB) | `local-lvm:vm-121-cloudinit` (4 MiB) | stopped, no lock or unused disks |

Main disk moves used `delete=0` and the current configuration digest to
retain the sources and reject concurrent configuration edits. Each main
copy took about 9.5 minutes. Both `scsi0` and `ide2` move tasks for each VM
were archived with status `OK`. Non-storage configuration fields were
compared with their pre-move values and were unchanged. Local storage
inventory independently confirmed each expected volume and its size.

Proxmox automatically removed the old regenerable cloud-init volumes during
their moves, even with `delete=0`. The corresponding log included an
uninitialized `$unused_key` warning, but each task ended `TASK OK`, its
archive status was `OK`, and the new 4 MiB cloud-init volume/configuration
was verified. No main disk was removed automatically.

After successful transfer and storage/configuration checks, only the exact
retained `unused0` source volume for each VM was removed through a
digest-guarded config operation. Both cleanup tasks were archived `OK`.
Final inventory showed no remaining `guild-templates` volumes for either
VM. Their data remains in the local volumes; the old shared copies are
deleted and are no longer separate rollback copies.

Final capacity sample:

- Shared storage: **6.389 GiB available**, up from zero; 182.098 GiB used.
- podF local-lvm: **1703.685 GiB available**, 6.327 GiB allocated.
- Existing worker test suite: **99 passed, 0 failed**.

Verification limits: neither VM was started, and no guest/application test
or independent byte-by-byte disk comparison was performed. Verification
covered successful Proxmox transfer/cleanup task archives, preserved VM
settings, local volume identities/sizes, source removal, stopped state and
recovered capacity. Individual task-status responses continued to say
`running` after `TASK OK`; completion was checked against the archive and
active-task lists rather than inferred from the submitted operation.

Direct SSH to podF reported a changed host key; the trust record was not
changed or bypassed. An authenticated API terminal reached a host login
prompt, not an authenticated shell, so no host password or login bypass
was attempted. Task-specific diagnostic sessions were stopped. A separate
Guild-B worker-console diagnostic timed out; fresh database node telemetry
confirmed the worker was still reporting node health.

## Remaining local-lvm rollout

The two existing VMs now use local-lvm. This does not make podC–podF
eligible for new Ubuntu instance creation yet. Current catalogue rows for
those nodes remain disabled and reference the shared source on podA;
the Ubuntu cluster target list remains `[podA]`.

Next implementation steps:

1. Prepare independent Ubuntu 24.04 templates directly on podC–podF
   local-lvm, without modifying podA or its template. Keep each new
   template out of scheduler admission until tested.
2. Test same-node clones and guest boot/networking with disposable VMs;
   validate worker permissions and cloud-init access. Test local thin
   linked clones as the faster path rather than repeating the large
   shared-storage transfer for every customer instance.
3. Register the verified node-local VMIDs and enable only passing nodes
   in the catalogue. Keep `storage_id=local-lvm` consistent between the
   scheduler, worker template resolver and actual disk placement.
4. Run a real console provisioning/access test. The 99 worker unit tests
   are not a substitute for that end-to-end result.
5. Address PBS capacity separately: 6.389 GiB of recovered shared space
   is temporary headroom, not a long-term backup capacity solution.

## Node-local Ubuntu template activation — 20:40 to 20:55 UTC

PodC, podE and podF were activated for Ubuntu 24.04 provisioning with
node-local templates on `local-lvm`. PodA was not modified. PodD was not
modified because the Guild-B cluster reported it offline and direct node
status lookup failed with hostname resolution errors.

Each template was seeded from a stopped validation VM already present on
the same node, scrubbed of inherited cloud-init password, SSH key and
custom snippet settings, converted to a template, then verified with a
same-node linked clone, boot and QEMU guest-agent command. The disposable
smoke VMs were stopped and purged after verification.

| Node | Template VMID | Source VMID | Storage | Clone mode | Smoke VMID | Result |
| --- | ---: | ---: | --- | --- | ---: | --- |
| podC | 9163 | 116 | `local-lvm` | linked | 9169 | booted, guest agent responded, purged |
| podE | 9165 | 114 | `local-lvm` | linked | 9168 | booted, guest agent responded, purged |
| podF | 9166 | 107 | `local-lvm` | linked | 9167 | booted, guest agent responded, purged |

Verified template configs showed `template: 1` and `scsi0` pointing at
`local-lvm:base-9163-disk-0`, `local-lvm:base-9165-disk-0` and
`local-lvm:base-9166-disk-0` respectively. Follow-up config reads for the
smoke VMIDs returned missing configuration files, confirming cleanup.

The catalogue was updated so `ubuntu-2404` on `guild-b` now has
`target_nodes = ['podA', 'podF', 'podE', 'podC']`. Per-node template rows
are enabled for podA, podC, podE and podF. PodB and podD remain disabled
in the per-node table.

Activation does not by itself restore end-to-end UI provisioning while the
Guild-B worker is stale. At 20:59 UTC, Supabase still showed
`worker_heartbeat_at = 2026-08-26T12:54:00Z` and
`capacity_observed_at = 2026-08-26T12:53:21Z` for `guild-b`; Proxmox
reported `lxc/500` on podD as `unknown`. The scheduler correctly rejects
stale capacity until the Guild-B worker is restored or redeployed on an
online node.
