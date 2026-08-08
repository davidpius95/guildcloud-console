# Decision record: G-10 — expanding the template catalogue

**Date:** 2026-08-08
**Status:** Fedora template complete and verified. Rocky Linux and
AlmaLinux downloading (bandwidth-limited connection, in progress).

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

## Rocky Linux 10.2 and AlmaLinux 10.2 — in progress

Both downloads running concurrently, competing for the same limited
uplink bandwidth (this site's real-world throughput fluctuates 350KB/s–
1.9MB/s per the download logs) — slower than Fedora's solo run. Will
follow the identical VM-creation steps once each download completes.
VMIDs reserved: 9004 (Rocky), 9005 (AlmaLinux) — confirmed free before
starting.

## What changed

- Live: VM 9003 created as a Fedora 43 template on Guild-A (`nodeD`),
  verified working.
- In progress: Rocky Linux and AlmaLinux images downloading to the same
  node, to become VMIDs 9004/9005 once complete.
