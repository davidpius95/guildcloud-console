# Dev log — 2026-08-08: G-17 complete — real performance numbers

## What happened

Last item from "work remaining gap register items." G-17: no performance
benchmark had ever been run against Guild-A; all capacity numbers were
configuration-time estimates.

## Method

Cloned two minimal throwaway VMs on different nodes (`bench-nodeb` on
`nodeB`, `bench-nodee` on `nodeE`), timed provisioning, ran a real `fio`
storage benchmark, and measured inter-node network throughput. Destroyed
both immediately after — zero persistent footprint, same discipline as
the earlier G-11 SDN validation.

## Results

- **Provisioning**: ~110-120 seconds clone→agent-ready (two independent
  measurements, using the VM start task's real timestamp and polling for
  guest-agent readiness).
- **Storage** (fio, 4K random 70/30 mix, on the same Ceph pool every real
  guest uses): 139 read IOPS / 62 write IOPS, write latency averaging
  10.87ms (p99 24ms, worst 148ms), disk 98.59% utilized during the test
  — genuinely saturated, not an idle artifact. Modest numbers, worth
  knowing before any customer-facing performance claim.
- **Network** (inter-node, `nc`+`dd` after `fio`/`iperf3` install got
  stuck behind a slow dist-upgrade on one VM): ~9.2MB/s (~73.6Mbps)
  sustained over 500MiB. Lower than expected for a LAN; not root-caused
  since it raced CPU contention from the concurrent dist-upgrade on the
  same guest — flagged as a real single data point, not a definitive
  ceiling.

## A genuine coincidence worth noting

While waiting on the stuck package install, noticed the guest's kernel
dist-upgrade was taking unusually long specifically at the initramfs-write
step — directly explained by the same low write throughput the fio test
had just measured moments earlier on the same storage class. Real
infrastructure behavior matching the benchmark, found by accident rather
than by design, but a genuine confirmation the numbers are real.

## What changed

- `docs/decisions/2026-08-08-g17-benchmark.md` — full record.
- `docs/phase-0/gap-register.md` — G-17 resolved with real numbers.
- No live infrastructure changed — both benchmark VMs fully destroyed.

## Session summary — all "remaining gap register items" now addressed

G-12 (corrected: monitoring exists but currently down), G-10 (resolved:
full 5-OS template catalogue), G-11 (validated: SDN works but has 2 real
gaps — broken SNAT, no tenant isolation), G-17 (resolved: real benchmark
numbers exist). Combined with everything else from today (G-03, G-05,
G-09, G-14, nodeA tag drift, Guild-B discovery and hardening, Headlamp
critical mitigation, PBS capacity), this was a very full session. Next
open threads: `podE` (deliberately deferred), the broken SNAT/isolation
findings from G-11, the other Guild-B public services still unreviewed
for the Headlamp-class issue, and whichever of Console/Phase 1/other gap
items the user wants next.
