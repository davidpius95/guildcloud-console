# Decision record: G-10 — expanding the template catalogue

**Date:** 2026-08-08
**Status:** complete. All three new templates built and verified —
Fedora 43, Rocky Linux 10.2, AlmaLinux 10.2 (VMIDs 9003/9004/9005).
Guild-A's catalogue now covers every OS named in plan §7.

## Context

Gap register G-10: Guild-A's template catalogue only had Ubuntu 26.04 and
Debian 13. Plan §7 names five: "Ubuntu (recommended), Debian, Fedora,
Rocky Linux, and AlmaLinux."

## Sourcing real, current images

The system date is 2026-08-08 — my training data doesn't know what OS
releases exist "in the future" relative to it. Rather than guess version
numbers or URLs, checked actual current directory listings before
downloading anything:

- Fedora: release 43 confirmed latest (dated Oct 2025).
- Rocky Linux: 10.2 confirmed latest (dated 2026-08-07 — one day old).
- AlmaLinux: 10.2 confirmed latest (dated 2026-08-06).

Used each distro's official GenericCloud/Cloud qcow2 image — the standard
format for cloud-init-based provisioning, matching how the existing
Ubuntu/Debian templates are built.

## Matching the existing pattern exactly

Read the existing `ubuntu-2604-guildvm-template` (VMID 9000) and
`debian-13-guildvm-template` (VMID 9001) configs first, then replicated
their exact shape for the new templates: 2 cores, 2GB RAM, `q35` machine,
`virtio-scsi-single`, QEMU guest agent enabled with `fstrim_cloned_disks`,
Tailscale vendor cloud-init snippet (`cicustom`), `ciuser=guildvm`,
DHCP cloud-init networking, same operator SSH key baked into the base
image, tagged `{os},template,cloudinit`, disk imported onto `ceph-vm`
(shared storage, matching the existing templates rather than local-only).

## Fedora 43 — complete

1. Downloaded via Proxmox's own `download-url` API (has the host itself
   fetch the file — no dependency on this session's own network access,
   which is sandboxed differently). 583.3MB, ~4m54s at this site's real
   bandwidth (~1.9 MB/s).
2. Created VM 9003 (`fedora-43-guildvm-template`) with the base config
   above, no disk yet.
3. Imported the downloaded qcow2 directly into `ceph-vm` as `scsi0`
   (`import-from=local:import/...`) — a local-network transfer, fast
   (~5GB in well under a minute), distinct from the internet-bound
   download step.
4. Attached cloud-init drive (`ceph-vm:cloudinit`).
5. Converted to template (`qm template`).
6. Verified the final config matches the established pattern exactly —
   `template: 1`, correct storage, correct tags.

## Rocky Linux 10.2 and AlmaLinux 10.2 — complete

Both downloads ran concurrently, competing for the same limited uplink
bandwidth (this site's real-world throughput fluctuated 350KB/s–1.9MB/s
per the download logs, occasionally bursting higher). AlmaLinux finished
first (547MB), Rocky shortly after (520MB). Both followed the identical
VM-creation steps as Fedora: create VM with the shared base config,
import the downloaded qcow2 into `ceph-vm` as `scsi0`, attach cloud-init,
convert to template. Both verified via a fresh config read (`template: 1`,
correct storage/tags) — not inferred from task exit status alone.

## Final state — verified

All 5 templates confirmed present via a live guest-list query:

| VMID | Name | OS |
| ---: | --- | --- |
| 9000 | `ubuntu-2604-guildvm-template` | Ubuntu 26.04 |
| 9001 | `debian-13-guildvm-template` | Debian 13 |
| 9003 | `fedora-43-guildvm-template` | Fedora 43 |
| 9004 | `rockylinux-10-guildvm-template` | Rocky Linux 10.2 |
| 9005 | `almalinux-10-guildvm-template` | AlmaLinux 10.2 |

Matches plan §7's catalogue exactly: "Ubuntu (recommended), Debian,
Fedora, Rocky Linux, and AlmaLinux."

## What this doesn't cover

Per §7, every template also needs "a version, owner, security-update
process, site synchronization procedure, private-access test, and
deprecation policy" — none of that lifecycle tooling exists yet, for any
of the 5 templates including the original Ubuntu/Debian ones. This work
closes the *catalogue* gap (the images exist), not the *lifecycle
management* gap (keeping them patched/current over time). Also scoped to
Guild-A only — Guild-B's own template catalogue (if it needs one,
depending on how Guild-B factors into the plan longer-term) wasn't
touched.

## What changed

- Live: VMs 9003 (Fedora), 9004 (Rocky Linux), 9005 (AlmaLinux) created
  on Guild-A (`nodeD`) as verified templates, matching the existing
  Ubuntu/Debian pattern exactly.
- Live: downloaded install images now also sit in `nodeD`'s `local`
  storage under `import/` (harmless residue from the import process, not
  cleaned up — matches the existing Ubuntu image already there from the
  original template build).
