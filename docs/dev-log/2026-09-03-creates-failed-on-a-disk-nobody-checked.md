# Dev log — 2026-09-03: instance creation failed on a disk nobody was checking

## What happened

A customer created an instance (`ol`). It was admitted, placed on podD, and
died 21 seconds later:

```
stage:  template_cloud_init
reason: ENOSPC: no space left on device, close
```

The instance was left `failed` with no vmid. The customer's evidence was a
broken half-built server.

## Why

Placement picked podD on the strength of `local-lvm`: 1.69 TB free, 3.9%
used. True, and irrelevant. The stage that failed writes a cloud-init
snippet to `guild-snippets` — a shared NFS export that was **98.3% full
with zero writable bytes**.

Admission never looks at that storage. `can_provision_instance` joins
`infrastructure_storage_targets` on the *template's* `storage_id`, so the
only storage it can see is the one the VM disk lands on. The snippet store
is invisible to it.

The control plane was observing the full filesystem every 30 seconds,
recording it faithfully in `infrastructure_storage_targets`, and then
ignoring it. Every create at this site was guaranteed to fail.

`routing.js` already carries a comment about this exact export filling and
breaking creates, from a previous occurrence. The lesson was written down;
the check was not.

The export is one 316 GB filesystem on 192.168.8.126 backing
`guild-snippets`, `guild-templates`, `guild-pbs` and `guild-pbs-import`
together — the whole homelab's PBS datastore, ~140 snapshots for vmids
unrelated to GuildCloud.

## Fixed

Clusters now declare `snippets_storage_id`, and admission requires
headroom on it. A create that cannot write its snippet is refused up
front, in the wizard, instead of failing mid-provision.

The refusal also says which resource ran out. The old message was one
sentence — "No eligible capacity is available for this image and plan
right now. Try Standard 1, a different image, or wait for more site
capacity" — regardless of whether the site was out of memory, missing a
template, or had a dead worker. Three of those are not helped by trying
Standard 1, and none are the customer's to fix. Reasons are now
distinguished: site closed, worker silent, no template, storage
unavailable, private networking, backups, memory, vcpu, disk.

Verified in production against the real broken state:

> This site cannot create servers right now: its shared storage
> (guild-snippets) is 98.3% full, and every new server needs to write there
> first. This is ours to fix, not yours — nothing you change about the plan
> or image will help.

and, when the snippet store is healthy, the memory case reports
"This site is out of memory for this plan" for std-4/std-8 while std-1 and
std-2 remain creatable.

## A floor that did not hold

The first version gated on 1 GiB free and **did not fire**. `total - used`
reports 5.1 GiB free for guild-snippets while Proxmox reports `avail: 0`:
the difference is reserved blocks, which a root-squashed NFS client cannot
use. Byte arithmetic over total/used overstates writable space on exactly
the filesystems that are about to reject writes.

A 5% proportional floor was added alongside it, which is the property that
actually separates this case (1.7% free). The durable fix is for the worker
to report the real `avail`; the column does not exist yet.

## Not fixed here

- **The disk is still full.** Creates now fail fast with a true reason
  instead of a broken VM, but they still fail. Freeing that export is an
  infrastructure decision (PBS prune/GC, or move snippets off it), not a
  code change.
- **The worker still does not report `avail`**, so the gate leans on a
  proportional proxy.
- **`health-snapshot.js` fabricates guild-templates capacity**: it hardcodes
  1000 GB total / 10 GB used for that storage regardless of what Proxmox
  says. The database therefore shows guild-templates 1.0% used while the
  API reports the same 316 GB filesystem at 98.3%. Nothing depends on it
  today (guild-b templates clone full to local-lvm), but it is a fabricated
  number inside the capacity model and should go.
