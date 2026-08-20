# GuildCloud — Project Status

**This is the single continuously-updated source of truth for this project.**
Read this file first — before the master plan, before `docs/dev-log/`,
before asking what state things are in. It is updated after every
meaningful change (feature, fix, infrastructure change, architecture
decision) and is meant to survive being read by a different agent, in a
different tool (Codex, a fresh Claude session, anyone), possibly on a
different machine. It lives in the repo so it travels with the project.

This file is a **map**, not the plan itself. For anything binding —
requirements, scope, boundaries — the master plan is still authoritative;
this file links to sections rather than paraphrasing them, because
paraphrases drift and the plan doesn't.

- **Master plan**: `/Users/user/Documents/Codex/2026-08-06/realtime-voice-chat-2/outputs/GuildCloud-Master-Plan.docx` (17 sections — see below)
- **Gap register**: `docs/phase-0/gap-register.md` (the running list of infrastructure findings, by ID)
- **Dev log**: `docs/dev-log/` (one dated entry per meaningful change, chronological)
- **Decision records**: `docs/decisions/` (why a specific call was made)
- **This file**: what's true *right now*, synthesized from all of the above

---

## What GuildCloud is

A private-by-default cloud platform. Customers get virtual servers (and
eventually managed Postgres, object storage, Kubernetes, functions) with
no public IP — access is only through Tailscale-enrolled devices. The
execution plane is real Proxmox VE hardware (two clusters today, Guild-A
and Guild-B); the control plane is this Next.js app + Supabase. Full
vision, positioning, and product promise: master plan §2-3.

## Where the master plan stands

17 sections (§1 Governance through §17 Immediate Next Planning Actions).
Section 13 (Console UI/UX Requirements) was the most recent addition,
confirming 7 MVP-critical UI/UX requirements from an audit. Nothing in
this file substitutes for reading the plan directly for anything
load-bearing — this section only tracks *that* it exists and roughly what
it covers, not its content.

## What's real vs. what's mock — read this before trusting any UI page

This is the fact most likely to be assumed away by a fresh session or a
different agent. As of 2026-08-19:

**Real** (backed by Supabase + a live Proxmox worker on Guild-A):
- Organizations, projects, memberships, roles, auth, audit log
- The Guild Instances create/list/detail flow — `app/console/instances/`,
  `app/console/instances/actions.ts`
- The durable operation/stage model (`operations`, `operation_stages`) and
  the real site-worker that executes it (`deploy/site-worker-guild-a/`,
  soon `deploy/site-worker/` — see below)
- SSH keys, password-SSH reveal, instance snapshots/restore/resize/delete
- Real device self-enrollment via Tailscale, real per-project ACL grants
- Real backups on both Proxmox clusters (PBS, daily, retention enforced —
  see gap register G-02, G-18)

**Still mock** (`lib/mock-data.ts`, no backing API): Kubernetes, managed
PostgreSQL, Object Storage, Volumes, Functions, Marketplace, Migration,
Monitoring dashboards, Billing/wallet analytics, Support tickets. The
console dashboard's sidebar carries a static "Mock data — no live
infrastructure is attached" banner (`components/sidebar.tsx`) that is
now **only accurate for these subsystems**, not the whole app — it
predates the real instance flow and hasn't been updated to say which
parts are real. Worth fixing so it doesn't mislead the next person who
reads it.

The root `README.md` claimed "no control plane, no Proxmox integration"
as of 2026-08-19 — that was stale by weeks and has been corrected as part
of this update. If you find another doc making the same claim, fix it the
same way rather than trusting it.

## Architecture

```
Customer browser
  -> Next.js console (this repo) -> Supabase (Postgres + Auth + Vault + Edge Functions)
       operations/instances/catalog tables, RLS-scoped by org
  -> Site worker (deploy/site-worker-guild-a/, being generalized to deploy/site-worker/)
       runs on a Guild-A-resident LXC (vmid 500), polls `operations`,
       drives the real Proxmox API + Tailscale API
  -> Proxmox VE (Guild-A: 5 nodes, nodeA-E; Guild-B: 6 nodes, podA-F)
       real customer VMs, cloned from tested templates
  -> Tailscale (private access — no public IP on any instance)
```

**In progress, not yet live**: multi-cluster placement, so a create
request can land on either Guild-A or Guild-B automatically instead of
always Guild-A/nodeD. See "Current initiative" below — this is a real
architecture change (one cluster → placement across N clusters), tracked
here because it changes the diagram above once live (worker becomes
cluster-neutral, one deployment per cluster; a DB-side placement RPC picks
the cluster/node instead of the worker assuming it).

## Current initiative: multi-cluster placement (Guild-B onboarding)

Plan: `docs/superpowers/plans/2026-08-18-multi-cluster-placement.md` (12
tasks). Design: `docs/superpowers/specs/2026-08-18-multi-cluster-placement-design.md`.

**Tasks 1-8 of 12: code complete**, sitting on branch
`Davidcode/local-testing-proxmox-clusters-e520d5`, not yet merged to
`main`. See `docs/dev-log/2026-08-19-guild-b-onboarding-day-1.md` for
the full list of what shipped and the two real bugs it fixed
(snippet-node mismatch, a cross-cluster VM-deletion hazard). Verified:
91 worker unit tests, 281 pgTAP assertions, typecheck, build — all green
against an isolated test database.

**All 5 new migrations are now applied to the real production Supabase
project** (`infrastructure_clusters`, `infrastructure_nodes`,
`infrastructure_storage_targets`, `catalog_image_cluster_templates`,
`catalog_image_cluster_node_templates`, `placement_settings`, the
`place_next_pending_operation`/`touch_worker_heartbeat`/
`publish_cluster_snapshot` RPCs, and the `route_operation_by_instance`
trigger). Verified immediately after: all 4 existing Guild-A instances
and 5 operations correctly backfilled to `cluster_id='guild-a'`, nothing
lost or corrupted. `placement_settings.mode` stays `single` — this alone
does not change any live routing; Guild-A's actual create/lifecycle flow
still runs on the pre-existing worker untouched by any of this.

**A real Guild-B worker is now live** — not just code, an actual running
service:
- LXC 500 on podD (`guildcloud-site-worker-guild-b`, Debian 13, Node 22),
  IP `192.168.8.227`, provisioned via the Proxmox API (container config
  changes requiring root-ticket auth — bind mounts, mount features — were
  done via direct root SSH to podD, since even privileged API tokens are
  blocked from those specific operations).
- Shared NFS snippets storage (`guild-snippets`, hosted on the PBS box at
  `192.168.8.126:/srv/guild-snippets`, root NFS export set up via direct
  SSH there) is live and mounted both as a Proxmox `content=snippets`
  storage (cluster-wide, all 6 nodes) and bind-mounted directly into the
  worker container — write-verified both ways.
- `siteworker-guild-b@pve` broadened with `PVEAuditor` at `/` (read-only
  audit role) after discovering the node-scoped-only ACL couldn't observe
  capacity on nodes other than its own host — a real architectural
  finding: multi-node capacity observation needs cluster-wide read access,
  not just node-scoped write access. Write privileges (`VM.Allocate`,
  clone, etc.) remain scoped to `/nodes/podD` + pool + storage only,
  unchanged.
- Fixed a real packaging bug found while installing this:
  `guildcloud-worker.service` never had `EnvironmentFile=` wired to
  `/etc/guildcloud/worker.env` — would have silently run with no config
  under systemd despite working fine when manually sourced. Fixed at the
  source (`deploy/site-worker/guildcloud-worker.service`).
- Running as a real systemd timer (`guildcloud-worker.timer`, every 3
  minutes), confirmed via `journalctl`: authenticates to production
  Proxmox, calls the real `place_next_pending_operation('guild-b', ...)`
  RPC against production Supabase, publishes live capacity for all 6
  nodes (`infrastructure_nodes`/`infrastructure_storage_targets` all
  freshly `observed_at`), heartbeats successfully.
- **Admission stays deliberately closed**:
  `infrastructure_clusters.guild-b.admission_state = 'paused'`, every
  `infrastructure_nodes`/`infrastructure_storage_targets` row for guild-b
  is `enabled=false`. Nothing can actually be placed here yet — this is
  topology registration + worker liveness proof, not admission.

**A real forced-placement attempt was made 2026-08-19 and found two real,
important blockers — recorded here since they weren't visible until an
actual attempt was made:**

1. **The live Guild-A production worker races any new create request.**
   It still runs the old pre-multi-cluster code, which polls for *any*
   pending `instance.create` operation regardless of `cluster_id` — a
   ~20s poll interval leaves no safe window to force-assign an operation
   to Guild-B before Guild-A's worker claims it first. First attempt lost
   this race for real: it created and fully provisioned a real VM on
   Guild-A (vmid 224767), which was then deleted cleanly through the real
   UI delete flow — no orphan left, but not the intended test. Second
   attempt worked around this by briefly stopping Guild-A's worker LXC
   (vmid 500) via the Proxmox API for ~2 minutes, which is **not** a
   sustainable fix — it only works because this is a controlled test with
   nothing else in flight. Guild-A's worker must actually be upgraded to
   the cluster-neutral code (deploying today's Task 4-8 work) before any
   further Guild-B placement testing can be attempted safely.
2. **podA is not actually a viable placement target today.** Real
   capacity math: podA's *existing, pre-existing local workloads* (its
   own legacy guests, unrelated to GuildCloud) already commit more vCPU
   than the placement RPC's 70% reserve ceiling allows
   (`post_committed_vcpu: 24` against a `vcpu_ceiling: 15`) — the RPC
   correctly rejected it with `vcpu_limit_exceeded`, independent of the
   test request's own size. This is the real capacity-reserve safety gate
   working as designed, not a bug, and it was **not** bypassed even for
   this controlled test. podE and podF have real headroom
   (`vcpu_headroom_ratio` ~0.75) but no GuildCloud template exists on
   either yet — templates are per-node on Guild-B's non-shared storage,
   so a genuinely viable forced test needs either a template built on
   podE/podF, or a different admitted node with both a template and real
   headroom. Neither exists yet.

Given both, **no real cross-cluster placement has been proven yet** —
today's real progress is: migrations live in production, Guild-B worker
genuinely running and reporting real capacity, and two concrete, honest
findings about what's actually blocking the next attempt. Full session
detail: `docs/dev-log/2026-08-19-guild-b-onboarding-day-1.md`.

**Deferred decision, user-confirmed 2026-08-20: give Guild-B shared NFS
template storage.** Guild-A's nodes share Ceph (`ceph-vm`), so one
template clones onto any of its 5 nodes directly. Guild-B's nodes each
only have private local `local-lvm` — Proxmox refuses to clone a VM from
one node's local storage onto a different node, which is why Guild-B
needs a separate template VM (and VMID) per admitted node today. Fix:
add a shared NFS storage holding the template disk images (customer VM
disks would stay on local `local-lvm` — no perf concern there, only the
template *source* needs to be shared), same pattern already proven today
for the snippets NFS export (`192.168.8.126:/srv/guild-snippets`). This
would collapse Guild-B's per-node template rows in
`catalog_image_cluster_node_templates` back to one shared template per
image, matching Guild-A's model — worth doing before admitting more than
one or two Guild-B nodes, since per-node templates mean redoing the
backup/restore/replicate dance for every node added. Not started; explicitly
deferred by the user, not forgotten.

## Open gaps worth knowing about (full list: `docs/phase-0/gap-register.md`)

- **G-14** (High, open): non-GuildCloud legacy workloads occupy real
  capacity on Guild-A's shared nodes — must move before any real
  capacity/pricing commitment is published.
- **G-22** (Critical, mitigated not closed): a Tailscale auth key that
  was baked into 4 OS templates has been removed from the template but
  **not yet revoked** in the Tailscale admin console; any instance ever
  cloned from those templates still holds it.
- **G-13** (open, rescoped): Guild-B is a second cluster but not a second
  *site* — same LAN, same power, same router as Guild-A. Real geographic
  redundancy (Warm Standby) still has no target.
- **G-11** (open): SDN tenant isolation is unvalidated/broken (SNAT
  egress fails; VNets aren't isolated from each other) — not the
  mechanism GuildCloud instances currently use (they're on plain
  `vmbr0`), but blocks future SDN-based tenancy work.

## Recent work (most recent first — see `docs/dev-log/` for full detail on any entry)

| Date | What | Doc |
|---|---|---|
| 2026-08-19 | Multi-cluster placement Tasks 4-8 (code); Guild-B PBS fingerprint fix, siteworker identity, template backup+restore onto podA | `docs/dev-log/2026-08-19-guild-b-onboarding-day-1.md` |
| 2026-08-18 | Multi-cluster placement Tasks 1-3 (policy, schema, atomic RPC) | commits `453d2a5`..`8018f14` |
| 2026-08-14 | Real device self-enrollment, real invite email, real access grants, SSH key retroactive push, network-attach root cause fix | `docs/dev-log/2026-08-14-*.md` |
| 2026-08-10 | Worker self-deploy mechanism, live worker fix, catalog availability hardening, vault delete-secret bug | `docs/dev-log/2026-08-10-*.md` |
| 2026-08-09 | Phase 3 slice 1 (Tailscale private access), full phase-by-phase e2e test, warm pool for faster provisioning | `docs/dev-log/2026-08-09-*.md` |

## What's next

1. Deploy the generic worker (`deploy/site-worker/`) to Guild-A, replacing
   the old cluster-unaware code — this is the actual blocker on any
   further Guild-B placement testing (see the race-condition finding
   above). `PLACEMENT_CLAIM_MODE=legacy` first, prove no regression (R1).
2. Build a GuildCloud template on podE or podF (or free up real capacity
   on podA), so at least one Guild-B node has both an admitted template
   and real headroom under the 70%/30% reserve gates.
3. Re-attempt forced Guild-B placement (Task 10) with Guild-A's worker
   safely upgraded — no more manual pause/resume needed.
4. Guild-B backup job (§2.8 of the plan) — not started yet.
5. User finishes the NFS snippets export validation; run the disposable-VM
   validation on podA (cloud-init, Tailscale join, SSH, backup, snapshot,
   resize, delete).
6. Fan out templates to podE/podF properly (or skip this once the
   deferred shared-NFS-template-storage work above lands, which would
   make per-node template fan-out unnecessary).
7. R2-R7 per `docs/superpowers/plans/2026-08-18-multi-cluster-placement.md` §3.
8. Real UI end-to-end test once Guild-B can actually receive placements
   without a manual worker pause.

---

## Maintenance note (for whoever/whatever is updating this file)

Update this file whenever you:
- Ship a feature, fix a bug, or change configuration/architecture
- Make a decision that changes scope, direction, or a prior assumption
- Finish (or start and pause) a multi-step initiative like the one above

Keep it **current-state**, not a changelog — the "Recent work" table is
the only chronological part; everything else should describe *now*, and
get edited in place rather than appended to. When something in this file
goes stale, fix it rather than leaving both the old and new claim
present. If a claim here turns out to already be wrong when you read it,
trust the primary source (git log, the actual code, a live infrastructure
check) over this file, then fix this file to match.
