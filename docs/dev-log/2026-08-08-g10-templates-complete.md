# Dev log — 2026-08-08: G-10 complete — full template catalogue

## What happened

Continued working the gap register. G-10: only Ubuntu 26.04 and Debian 13
templates existed; plan §7 names five OSes.

## Sourcing correctly, not from memory

The system date is 2026-08-08. Training data doesn't know what OS
releases are current at that date, so checked real, live directory
listings (Fedora, Rocky Linux, AlmaLinux mirrors) before downloading
anything, rather than guessing version numbers that might not exist.
Confirmed: Fedora 43 (Oct 2025), Rocky Linux 10.2 (2026-08-07 — one day
old), AlmaLinux 10.2 (2026-08-06).

## Matching the existing pattern exactly

Read the existing Ubuntu/Debian template configs first and replicated
their shape precisely for all three new ones: 2 cores, 2GB RAM, `q35`,
`virtio-scsi-single`, guest agent enabled, Tailscale vendor cloud-init
snippet, `ciuser=guildvm`, DHCP networking, same operator SSH key, tagged
`{os},template,cloudinit`, disk on `ceph-vm` (shared storage).

## Execution

Downloaded all three images via Proxmox's own `download-url` API (host
fetches directly — not dependent on this session's own sandboxed network
path). All three ran concurrently, genuinely bandwidth-limited by this
site's real connection (350KB/s–1.9MB/s, fluctuating) — Fedora finished
first (~5 min solo), then Rocky and AlmaLinux finished close together
after competing for the remaining bandwidth. For each: created the VM,
imported the downloaded qcow2 into `ceph-vm` (a fast local-network
transfer, unrelated to the internet-bound download step), attached
cloud-init, converted to template, and verified via a fresh config read
— not inferred from any task's exit status alone.

## Result

Five templates now on Guild-A: Ubuntu 26.04, Debian 13, Fedora 43, Rocky
Linux 10.2, AlmaLinux 10.2 (VMIDs 9000/9001/9003/9004/9005). Verified as
a set via a live guest-list query.

## What this doesn't cover

§7 also requires lifecycle management per template — version tracking,
security-update process, site sync, deprecation policy. None of that
exists for any of the 5 templates, old or new; this closes the catalogue
gap, not the lifecycle gap. Guild-B's own template needs (if any) weren't
addressed.

## What changed

- Live: 3 new VM templates on Guild-A (`nodeD`): 9003 (Fedora), 9004
  (Rocky Linux), 9005 (AlmaLinux).
- `docs/decisions/2026-08-08-g10-template-catalogue.md` — full record.
- `docs/phase-0/gap-register.md` — G-10 resolved.

## Still open in the register

G-11 (unused SDN zones) and G-17 (no benchmark run) remain from the
"work remaining gap register items" direction.
