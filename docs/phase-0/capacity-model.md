# Phase 0 — Capacity Model: Guild-A

**Survey date:** 2026-08-07. Derived from `site-inventory.md`. This is a
configuration-time snapshot, not a load test — no benchmark was run. Master
Plan §16 requires this step before any catalogue or price is published, and
explicitly before §11's 30% reserve is applied.

---

## 1. Raw capacity

| Resource | Total | Notes |
| --- | ---: | --- |
| vCPU (cores, all nodes) | 20 | 4 per node × 5 nodes |
| RAM | 74.80 GB | Sum of node totals; **not evenly distributed** |
| Ceph raw storage | 1.012 TB | 4 OSDs × ~250 GB, replicated |
| Ceph usable @ size=3 | **~337 GB** | Every byte written 3×; this is the number that matters, not raw |
| Local (non-shared) storage | ~390 GB combined | LVM-thin + dir, per-node, does not migrate |

## 2. Currently committed

| Resource | Used now | % of raw |
| --- | ---: | ---: |
| RAM (running guests, actual usage) | 35.54 GB | 47.5% |
| Ceph raw used | 163.42 GB (`ceph-vm`) + ~14 MB (`.mgr`) + ~97 KB (`k8s-rbd`) | 16.14% of `ceph-vm`'s share |
| Ceph logical (real data, pre-replication) | 54.47 GB | — |

11 VMs + 5 containers exist; 9 guests are actually running. The gap between
"16 guests provisioned" and "9 running" matters for planning: stopped guests
still reserve disk, not RAM or CPU.

## 3. What a 30% reserve (§11) means on this cluster today

The plan requires "each site keeps a 30% capacity reserve... new placement
stops automatically before this reserve is breached."

| Resource | Raw | Reserve threshold (70% max use) | Already used | **Headroom before reserve trips** |
| --- | ---: | ---: | ---: | ---: |
| RAM | 74.80 GB | 52.36 GB | 35.54 GB | **16.82 GB** |
| Ceph (`ceph-vm`, usable) | ~337 GB | ~236 GB | ~54.47 GB (logical) | **~182 GB** |
| vCPU | 20 cores | 14 cores | low (3.5–12.1% load, not core-committed) | not binding |

**RAM is the constraint, not storage or CPU.** At 16.82 GB of headroom before
the reserve line, and no plan sizes published yet, this cluster cannot safely
support many concurrent Guild Instances without either adding RAM or
tightening the per-instance memory footprint below what the console's current
mock catalogue assumes (Standard 4 = 8 GB, Standard 8 = 16 GB — a single
Standard 8 would consume the entire remaining headroom by itself).

nodeC's 8.21 GB (half of every other node) is the tightest single constraint:
if placement logic is memory-aware per-node rather than cluster-wide, nodeC can
host meaningfully less than the other four.

## 4. Per-node placement ceiling (informational, not a plan/quota decision)

This section states measured headroom only. It is deliberately **not** a
catalogue or price — per §16, that requires its own step after this one.

| Node | RAM total | RAM used | RAM free | Ceph OSD present |
| --- | ---: | ---: | ---: | --- |
| nodeA | 16.65 GB | 12.95 GB (77.8%) | 3.70 GB | Yes |
| nodeB | 16.65 GB | 5.94 GB (35.7%) | 10.71 GB | Yes |
| nodeC | 8.21 GB | 4.08 GB (49.7%) | 4.13 GB | Yes |
| nodeD | 16.65 GB | 8.39 GB (50.4%) | 8.26 GB | Yes |
| nodeE | 16.65 GB | 4.18 GB (25.1%) | 12.47 GB | No |

nodeA is already the tightest node in the cluster and also carries the most
guests (mediastack, coolify, jellyfin, ingress). It should not receive new
placements until either workloads are rebalanced or migrated per the G-14
policy below.

## 4.1 Reclaimable vs. structural headroom (G-14, decided 2026-08-07)

Per `docs/decisions/2026-08-07-g14-legacy-workload-policy.md`, the
pre-existing non-GuildCloud workloads on nodeA/B (mediastack, coolify,
pdm-datacenter, jellyfin, rabbitmq, irc, ingress — excludes `proxmox-mcp`,
which is GuildCloud's own tooling) are **temporary occupants, not permanent
overhead**:

| | RAM |
| --- | ---: |
| Actual usage today | ~10.08 GB |
| Configured ceiling | ~22.53 GB |

This is not counted as a structural reduction to the 16.82 GB headroom
figure above — it is **reclaimable** capacity, expected to be freed by
migration before any real catalogue/pricing commitment is published (Phase
9 or earlier). Until that migration happens, treat the *effective* usable
headroom for planning purposes as tighter than 16.82 GB suggests, since
these workloads are real and running today even though they're not
permanent.

## 5. What this model deliberately does not do

- It does not propose plan sizes (Standard 1/2/4/8) or prices. §16 requires the
  capacity model to exist first, then a "capacity model and initial catalogue
  proposal" as a separate follow-on step — this document is the input to that
  step, not the step itself.
- It does not include a second site, since only Guild-A exists (see
  `site-inventory.md` §1).
- It does not include benchmark-derived per-workload cost (CPU-seconds,
  IOPS profile). Those require the load test explicitly deferred here.
- It does not include a second site, since only Guild-A exists (see
  `site-inventory.md` §1).
- It does not include benchmark-derived per-workload cost (CPU-seconds,
  IOPS profile). Those require the load test explicitly deferred here.
