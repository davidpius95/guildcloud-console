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
- Real device self-enrollment via Tailscale, real per-project ACL grants.
  Enrollment links are reusable (90-day Tailscale authkey, not one-time —
  user decision 2026-08-25) and one-click: the "Enroll device →" link in
  `components/remote-access-guide.tsx` lands on
  `/console/networking?connect=1`, which `EnrolledDevicesCard` auto-detects
  and immediately generates the command — no longer requires a second click
  on "Connect this device" after navigating there. The generated script
  (`app/api/enroll/[token]/route.ts`) runs `tailscale up --reset ...` so
  re-running it on a device that's already enrolled (the whole point of a
  reusable link) doesn't hit Tailscale's "requires mentioning all
  non-default flags" error. Verified live end-to-end 2026-08-25: real
  laptop ran the generated command, connected successfully.
- Real backups on both Proxmox clusters (PBS, daily, retention enforced —
  see gap register G-02, G-18)

**No longer mock — `lib/mock-data.ts` is deleted (2026-08-25).** Every
console surface now renders either the signed-in customer's real data or an
explicit "Not available yet" state. What that removed:

- The **topbar**, on every page, showed a hardcoded stranger's name
  ("Saurabh Rapatwar"), a fabricated `$412.60` wallet, a fabricated unread
  alert badge, and a project switcher listing projects belonging to nobody.
- The **dashboard** — the first page after login — greeted every user as
  "Northwind Labs" and reported invented instance counts, spend, quotas,
  alerts, and site health.
- The **create wizard** offered "Abuja 1" and "Amsterdam 1" as selectable,
  "Accepting new work" sites. No cluster has ever existed at either: both
  real clusters (guild-a, guild-b) map to `lag-1`. A create there passed the
  wizard's own gate and then failed placement server-side. Sites now come
  from `list_admittable_sites()`.
- **Volumes, Billing, Support** sat in the main nav as working features
  while rendering entirely invented rows.
- The **instance detail page** had a ~200-line mock rendering path (fake
  utilisation meters, fake volumes, fake cost, a fake "recovery console")
  reachable by visiting any hardcoded mock id.

Genuinely unbuilt surfaces (Volumes, PostgreSQL, Object Storage, Kubernetes,
Functions, Monitoring, Marketplace, Migration, Support) now say so via a
shared `ComingSoon` component and are grouped under "Coming soon" in the nav
instead of being mixed into active groups. Billing shows the real wallet
balance and the real committed monthly maximum, with invoices/payment
methods explicitly marked unbuilt.

Real formatters moved to `lib/format.ts`; the plan/image catalogue (a display
mirror of real seeded `catalog_plans`/`catalog_images` rows) to
`lib/catalog.ts`.

## Architecture

```
Customer browser
  -> Next.js console (this repo) -> Supabase (Postgres + Auth + Vault + Edge Functions)
       operations/instances/catalog tables, RLS-scoped by org
  -> place_next_pending_operation() RPC picks a cluster/node (mode: multi)
  -> Site worker (deploy/site-worker/, one deployment per cluster)
       runs on a dedicated LXC per cluster (Guild-A: vmid 500 on nodeD;
       Guild-B: vmid 500 on podD), polls `operations` scoped to its own
       cluster_id, drives the real Proxmox API + Tailscale API
  -> Proxmox VE (Guild-A: 5 nodes, nodeA-E; Guild-B: 6 nodes, podA-F)
       real customer VMs, cloned from tested templates
  -> Tailscale (private access — no public IP on any instance)
```

Multi-cluster placement is **live** — confirmed 2026-08-25 (see "Current
initiative" below). A create request can land on either cluster
automatically based on real capacity scoring, not just Guild-A/nodeD.

## Production deployment — real, live as of 2026-08-25

Before today there was **no real production deployment** — `guildcloud-console.vercel.app`
returned Vercel's `DEPLOYMENT_NOT_FOUND` (no project existed behind that
domain, no `.vercel/` link, no CI/CD, no GitHub webhook). "Site can't be
reached" reports from a second laptop weren't an auth bug, they were this:
there was nothing to reach.

Fixed: linked this repo to a real Vercel project (`davidpius95s-projects/guildcloud-console`,
created via `vercel link`), set the three required env vars
(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`NEXT_PUBLIC_SITE_URL=https://guildcloud-console.vercel.app`), and deployed
with `vercel --prod`. `.vercelignore` excludes `.claude/worktrees` (leftover
local session data, ~780MB) since it isn't part of the app and was making
uploads fail outright. `.vercel/` itself is gitignored, same treatment as
`.env.local` — it's a local project link, not something to commit.

**Also fixed as part of this**: Supabase Auth's Site URL was still a stale
`http://localhost:3000` and the production domain wasn't in the Redirect
URLs allow-list, so `signInWithOAuth`'s `redirectTo` was being silently
rejected and falling back to that stale Site URL — Google sign-in from any
machine other than that one dev box completed at Google, then bounced to
an unreachable `localhost:3000`, which is exactly the "site can't be
reached" symptom reported. Not a code bug — `lib/site-url.ts` was already
correct (see 2026-08-14 entry below). Fixed by updating Supabase dashboard
→ Authentication → URL Configuration: Site URL and Redirect URLs both now
point at `https://guildcloud-console.vercel.app`.

**Verified end-to-end on the real production URL, not just locally**:
Google sign-in completes and lands in `/console`; created a real instance
via the full wizard (Standard 1, Lagos 1 site) which reached `ready` in
~3 minutes through the same real Guild-A worker/Proxmox path as local; got
real SSH/hostname/private-IP connection details; deleted it again through
the real UI teardown flow. Two test instances created during this
verification (`prod-e2e-test` server 104, `e2e-test-25aug` server 103,
created earlier the same day against local dev but the same Supabase
backend) were both deleted afterward — real Proxmox teardown + Tailscale
device removal, not just DB rows.

**CD is now wired (2026-08-29).** The Vercel project is connected to the GitHub
repository (`vercel git connect`), so a push to `main` deploys to production
automatically and pull requests get preview deployments. Before this, `vercel --prod`
was a manual step, and the consequences were not hypothetical: production ran a
**two-day-old build** whose delete button called a superseded RPC overload that
stranded instances, and three separate faults on 2026-08-29 traced back to code and
production drifting apart with nothing to catch it.

Test CI exists (`.github/workflows/ci.yml` — lint, typecheck, worker tests, pgTAP,
build, audit, accessibility) and **passes as of 2026-08-29**; it had failed on every
run since being introduced, because `npm ci` exited on a dependency conflict before
reaching a test, so the gate was decorative until PR #14 repaired it.

**One gap remains in the new setup:** Vercel builds independently of GitHub Actions,
so a commit whose tests fail but whose `next build` succeeds will still deploy. A
broken build cannot reach production (Vercel runs `npm run build` itself), but a
failing test suite does not block a deploy. Closing that needs a GitHub Actions job
holding a `VERCEL_TOKEN` and promoting to production only after CI is green — worth
doing, and it requires creating that token. Superseded text below: `vercel --prod` was run manually
from a session, so `main` and production can still drift if someone pushes
without redeploying. Worth wiring a GitHub → Vercel git integration (or a
GitHub Actions step) so every merge to `main` auto-deploys, rather than
relying on someone remembering to run `vercel --prod`.

**Second public URL added 2026-08-27**: `cloud.guild-technologies.com` is
now a Cloudflare-DNS custom domain pointed straight at this same Vercel
project (CNAME, proxy disabled, cert verified) — a separate hostname from
`guildcloud-console.vercel.app`, same deployment. No redirect/canonical
choice has been made between the two yet. This is unrelated to the
self-hosted `guildcloud-console.guild-technologies.com` (see gap register
G-21) — that one serves a different, self-hosted instance on Guild-A/B
infrastructure via the Cloudflare Tunnel + Caddy ingress, not Vercel. See
`docs/dev-log/2026-08-27-custom-domain-and-ingress-route-fix.md`.

## Current initiative: platform hardening and launch (started 2026-08-29)

Plan: `docs/2026-08-29-guildcloud-platform-hardening-and-launch.md` (12 tasks).
It carries its own verified status table — read that for per-task detail; this
section is the summary.

The plan's goal is to turn the working control plane into an honest, recoverable,
secure, operable service without rewriting the Next.js/Supabase/Proxmox/Tailscale
foundations. One commit has landed so far — `a3b9744 "fix: harden instance
lifecycle correctness"` (branch `guildcloud-correctness`), merged to `main` via
PR #11. Audited directly against the repo on 2026-08-29:

**Real (done and verified):**
- **Task 2, quality gate.** `next lint` (removed in Next 16) replaced with flat-config
  ESLint; `middleware.ts` renamed to `proxy.ts` with the 1.5s bounded session refresh
  preserved; `scripts/check-migrations.sh` rejects duplicate timestamps, `CONCURRENTLY`,
  and SECURITY DEFINER functions missing `search_path`/REVOKE/GRANT; real CI at
  `.github/workflows/ci.yml` (three jobs, Postgres image pinned by digest).
  `npm audit --omit=dev` is clean.
- **Task 4, atomic lifecycle intent.** `20260829110000_add_atomic_instance_intents.sql`
  adds all five `request_instance_*` RPCs plus `finish_instance_operation`, extends the
  instance-state constraint (`snapshotting`, `resizing`, `restoring`, `delete_failed`),
  and adds a unique partial index enforcing **one active operation per instance**.
  `app/console/instances/actions.ts` is now RPC-only — the RLS-blocked multi-statement
  writes that could silently match zero rows are gone. Restore-to-new (which created a
  blank VM rather than restoring data) is removed entirely.
- **Task 5/6, truthful worker execution.** `deploy/site-worker/lifecycle.js` awaits every
  Proxmox UPID, confirms the snapshot actually appears in the VM list, rejects an empty
  snapshot instead of rebooting as a successful no-op, resolves the real boot disk rather
  than hardcoding `scsi0`, refuses any disk shrink, and never reports success after a
  partial disk failure. Nine unit tests cover it.
- **Task 7, duplicate worker removed.** `deploy/site-worker-guild-a/index.js` — the
  1,293-line second source of truth — is now a two-line tombstone, with
  `single-source.test.js` failing the build if a second Proxmox implementation reappears.

**Partial — do not read as done:**
- **Task 3, capability contract.** `lib/platform-capabilities.ts` exists and the console
  surfaces were made honest by hand, but **nothing imports the contract** except its own
  test. The flags document intent without enforcing anything, so flipping one changes no
  behaviour. Two stale strings survive: `components/sidebar.tsx:173` still says "Guild-B
  onboarding", and `app/console/projects/[id]/page.tsx:48` still claims Phase 2 isn't
  wired up. `docs/content/product-claims.md` was never created.
- **Task 4 gaps.** No request RPC writes an audit event — customer lifecycle intent is
  currently **unaudited**. `finish_instance_operation` never checks that the calling
  worker's cluster owns the operation. Resize skips the disabled-plan and site-capacity
  checks.
- **Task 5 gap.** No bounded-lease reconciliation for operations stranded in `running`.
  `snapshots` and `replaceRestore` are already enabled, so this is customer-reachable.
- **Task 8.** Vitest/Testing Library/Playwright are installed and in CI, but the suite is
  four tests. No fixture E2E project, no seeded role matrix, no axe gate, and **no
  forgot-password or MFA route exists at all**.

**Not started:** Task 1 (reproducible baseline schema — the repo still cannot rebuild
Phase 1 from scratch), Task 9 (observability, support, restore drills), Task 10 (billing
ledger), Task 12 (staged launch). Task 11 is a deliberate design backlog.

**Task 7's code has since landed (PR #15, `d58694d`).** The site worker now has a
`guildcloud_site_worker` database role with no table privileges, a `worker_identities`
table mapping each worker to exactly one cluster, and `worker_*` RPCs covering every
path it previously reached by writing tables directly. The cluster is resolved from the
database rather than from the token, so a stolen worker token cannot widen its own scope
and revoking a worker is a single `UPDATE` instead of a JWT-secret rotation.

**The service-role key is still on both production workers.** Removing it is the
operational half: mint tokens, canary one cluster, rotate the key. That is written up in
`docs/runbooks/2026-08-29-worker-service-role-cutover.md`, and `CONTROL_PLANE_AUTH_MODE`
still defaults to `service_role`, so nothing has changed for a running worker yet.

**Both clusters are cutover-ready except for the token (2026-08-29).** Worker
identities are registered and each box's `WORKER_ID` matches, which
`assertWorkerToken` requires or the worker refuses to start:

| | Guild-A | Guild-B |
| --- | --- | --- |
| Identity | `guild-a-lxc-500-r2` | `guild-b-lxc-500` |
| Housekeeping | yes (wider surface) | no (**narrower**) |
| Worker code supports `worker_token` | yes | yes |
| Token minted | operator | operator |

`guild-a-lxc-500` is **revoked and burned** — its token leaked into this public
repository and must never be re-minted, hence the `-r2` id. Guild-B's id needed
no change: only Guild-A's was compromised. **Guild-B is the better canary**, since
it exercises only the cluster-scoped RPCs.

None of this grants anything yet: no token exists, and the legacy path never
reads `worker_identities`.

**The remaining steps need a human.** Minting a worker token requires the
project's JWT secret, which is deliberately kept away from any agent — the whole
argument for a one-shot operator script over Terraform was that the credential
lives in exactly one place. Steps 4 and 7 additionally need root on the two
worker LXCs and dashboard access to rotate the service-role key. Guild-B is the
intended canary, since Guild-A holds housekeeping and so carries the wider
surface.

## Repository sync state (checked 2026-08-29)

Everything is merged. `origin/main` @ `5de0562` contains all work; both other remote
branches (`guildcloud-correctness`, `Davidcode/guildcloud-console-service-30aa09`) are
strictly behind it with nothing ahead, no worktree holds uncommitted work beyond a
`@types/node` version-range bump sitting uncommitted in the main checkout, and the stash
is empty.

## Previous initiative: multi-cluster placement — LIVE in production (2026-08-25)

Plan: `docs/superpowers/plans/2026-08-18-multi-cluster-placement.md` (12
tasks). Design: `docs/superpowers/specs/2026-08-18-multi-cluster-placement-design.md`.

**This is done and live, further along than this file previously tracked.**
Found 2026-08-25 by directly inspecting the running system (not assumed):
`placement_settings.mode = 'multi'`, both `infrastructure_clusters` rows
(`guild-a`, `guild-b`) show `admission_state = 'open'` with fresh
heartbeats (seconds old at time of check). Guild-A's LXC 500 is running
the real generic worker (`deploy/site-worker/index.js`, verified by
reading its actual header comment on the box) via the proper staged-release
mechanism (`current` symlinked to a timestamped `releases/` directory,
`.deployed-checksum` present) — not the old flat-copy launcher that broke
things on 2026-08-19/20. `--print-config` confirms `placementClaimMode:
"rpc"`, `clusterId: "guild-a"`, correct token/pool/snippets config.
`journalctl` shows clean 3-minute cycles, no errors. Guild-B's worker is
equally healthy. Neither this file nor the user knew this migration had
completed — it happened via other sessions between 2026-08-19 and today;
this file is now corrected to match reality rather than repeating stale
"not yet deployed" language.

**Real cross-cluster placement has actually succeeded**: instance
`ui-test-guild-b-vm` (created via the real UI, 2026-08-20) is `state:
ready` on `cluster_id: guild-b`, `proxmox_node: podE`, `proxmox_vmid: 105`
— a genuine, automatically-placed Guild-B instance, not a forced/manual
one. This is the actual proof-of-concept the whole initiative was aiming
for. Three later create attempts on podF failed (ENOSPC — see below,
now fixed) and were never retried; found and cleaned up 2026-08-25 (one
had been stuck in `state: deleting` for 4 days with its VM still present
on Proxmox — deleted directly via the Proxmox API + DB cleanup since
neither worker's own deletion path had a stuck-item retry mechanism for
one whose create had already failed).

Tasks 1-8 of 12 code: merged to `main` (PR #6, `bfdd7d8`, plus follow-on
fixes `a404de5`/`d52ecba`/`41c177c` from later sessions — see Recent work).
All 5 migrations applied to production, verified not to have disturbed
pre-existing data. See `docs/dev-log/2026-08-19-guild-b-onboarding-day-1.md`
for the original day's detail.

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

## Resolved 2026-08-25, but only temporarily: the Guild-B shared NFS export was full

`192.168.8.126` hosts one 211 GB filesystem serving three Proxmox storages —
`guild-snippets`, `guild-templates`, and the PBS datastore
(`guild-a-standard`). It hit **203 GB used, 0 available** on 2026-08-22,
which broke Guild-B creates at `template_cloud_init`
(`ENOSPC: no space left on device`) and silently truncated that night's
backups to 1-byte stubs.

Ran PBS garbage collection directly on the box 2026-08-25 (SSH, real admin
access) — it also initially failed with the same ENOSPC, because the
`backup` system user (not root) runs the PBS proxy daemon and couldn't
touch the filesystem's ~8.75 GB root-only reserved-blocks margin
(`tune2fs`, default ext4 5% reserve). Temporarily set the reserve to 0%,
ran GC (`TASK OK`, removed 9.73 GiB / 10,097 chunks), then restored the
reserve to its original value. **Current state: 3.2 GB available** — real
headroom, but tight, and confirmed refillable by the same legacy-guest
snapshot growth that caused this the first time. `gc-schedule: daily` is
already configured on the datastore, so this should self-clean going
forward *as long as new growth stays below what daily GC can reclaim* —
**tightening retention on the large legacy guests (vm/600 @ 161GB, vm/122
@ 150GB, and vm/100/120/200) is still the durable fix, not done.**

## Guild-B clone target moved to local-lvm (2026-08-22)

Guild-B's template lives on the shared NFS (`guild-templates`), and every
instance was a *linked* clone of it. Proxmox pins a linked clone to its
base's storage, so customer disks landed on that same full 211 GB export
while each node's own `local-lvm` sat at 0 bytes used with 1.6-3.5 TB free.

Fixed (`a404de5`, on `main`): `buildCloneParams` in
`deploy/site-worker/routing.js` passes a target `storage`, which Proxmox
only honours for a **full** clone; Guild-B's rows in
`catalog_image_cluster_templates` and `catalog_image_cluster_node_templates`
moved to `clone_mode='full'` + `storage_id='local-lvm'` (applied directly to
production). Guild-A is unaffected — `ceph-vm` is shared, its templates stay
linked, and a linked row never sets `storage`. Placement now scores Guild-B
against real per-node local disk instead of the hardcoded values still
present in `deploy/site-worker/health-snapshot.js:61`, which report
`guild-templates` as a flat 1 TB/10 GB regardless of reality — **that
hardcode is still there and should be removed.**

Note this does *not* unblock creates on its own: the ENOSPC came from the
cloud-init snippet write, which still targets the full NFS.

## `instances.updated_at` exists as of 2026-08-29

`instances` recorded creation but never last change, so there was no way to ask
how long an instance had been in its current state — and reaching for
`created_at` gives a number that looks like an answer and is not one. That caused
two misdiagnoses: three instances reported as "stuck deleting for three days"
(2026-08-27) when it had been about a minute, and four reported as stranded since
08-28 when deletion had been requested that afternoon.

The column is **nullable with no backfill**. `NULL` means "not updated since the
column was added", which is the truth; backfilling `created_at` would have
reintroduced the exact failure it fixes. Treat `NULL` as unknown rather than
coalescing it to `created_at`. A trigger stamps it on real changes only — a
no-op `UPDATE` does not re-stamp, or the column would be as misleading as
`created_at` was.

## Cleaned up after the 2026-08-29 delete fault — one item still open

The broken delete left a real orphan, now **confirmed and removed**: VM 111
(`verify-t7-e2e`) was still running on Guild-B podF an hour after its instance
was supposedly deleted, holding 2 vCPU / 4 GB. It survived because the delete was
a race the stage machine won outright — it finished ~50s after the request, while
the teardown sweep only runs once per three-minute worker cycle, so by the time
the sweep looked the instance was `ready` again and no longer a deletion
candidate. Stopped and destroyed with purge; podF re-read afterwards shows only
the six legitimate instances, the node template, and two legacy guests.

Cleaned up alongside it: **five stale cloud-init snippets** on the shared
`guild-snippets` NFS export. Three carried a Tailscale auth key and an instance
one-time password (per the worker's own comments) on a share bind-mounted into
the worker container; two were 0-byte truncation remnants of the August ENOSPC
incident. Each was verified unreferenced first — the export is mounted on all six
Guild-B nodes, and deleting a snippet a VM still names in `cicustom` makes that
VM permanently unstartable. Two were named for live VMIDs (VM 100
`guildcloud-dev`, running; VM 102 the podF template seed) and both configs were
checked for `cicustom` before deleting.

**Still open:** the orphaned tailnet device `instance-1142e8a0-1`
(id `3346168422532813`, `100.69.78.32`, offline since 15:13:41). The Tailscale
MCP refuses device deletion at the available permission level, so it needs the
admin console or a device-delete-scoped token. Its root cause is now **G-25**:
the worker binds an instance to its Tailscale device by *hostname*, and Tailscale
allows duplicate hostnames, so a collision binds the control plane to the wrong
device — which is also why cleanup deleted VM 111's device rather than 112's.

Also worth carrying forward: the Proxmox MCP's dedicated wrappers
(`get_vms`, `get_vm_status`) silently target the server's **default** cluster
(guild-a), so asking them about a Guild-B node returns TLS / `No route to host`
errors that look like a network fault. Use `pve_call` with an explicit
`cluster='guild-b'`.


## Open gaps worth knowing about (full list: `docs/phase-0/gap-register.md`)

- **G-24** (Critical, **partly resolved 2026-08-27**): the console could admit
  **no new instances at all**, on either cluster, for any image or plan — the
  product's primary flow was unavailable. Two causes, both fixed for Guild-B
  podB–podF: (1) `can_provision_instance()` (the wizard gate) enforced far
  stricter ceilings (`0.7` vCPU, 30% memory) than
  `place_next_pending_operation()`, which actually places VMs (`2.0` vCPU,
  1 GiB memory) — so the wizard refused creates placement would have accepted;
  (2) the Guild-B worker lacked `VM.Clone` on the per-node template VMs, and
  **pool membership did not confer it** (templates in the `guildcloud-guild-b`
  pool still returned `VM.Clone: 0`) — only explicit `/vms/<vmid>` ACLs worked.
  **podA and all five Guild-A nodes were deliberately left on the strict
  defaults and still cannot admit work** — that remainder is G-14's
  legacy-workload problem. Verified with two real end-to-end creates on two
  different pods. See
  `docs/dev-log/2026-08-27-guild-b-pod-admission-and-clone-acls.md`.
- **G-01** (**resolved 2026-08-25**, was Critical): the tailnet wildcard
  grants that let any enrolled customer device reach `tag:guildcloud-mgmt`
  as root are gone — `infra/tailscale/policy.hujson` shipped via PR #7/#8,
  verified live by directly re-reading the applied policy (not just CI/merge
  status). Management SSH is operator-only now; customer SSH into instances
  is non-root only; tenant-project grants no longer reach the management
  zone. Full reasoning: `docs/decisions/2026-08-22-tailnet-wildcard-grants-and-drift.md`.
  **Not fixed by this**: `access_grants` still enforces nothing
  (display-only) — an enrolled member reaches every project in their org
  regardless of what the Access policy card shows. Needs a per-project
  membership concept (schema change), tracked separately from G-01.
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
| 2026-08-29 | Found the delete button had **never** worked: a one-argument `request_instance_deletion` overload set instances to `deleting` and queued nothing. 52 delete requests since 08-10 produced zero delete operations. Dropped it; cleaned up four instances stranded that way | `docs/dev-log/2026-08-29-deploy-drift-leaked-token-and-a-delete-that-never-deleted.md` |
| 2026-08-29 | Installed the deploy mechanism on the Guild-B worker, which had none at all (hand-copied code, no timer, no releases). Found and fixed a test that was silently rejecting every worker deploy on **both** clusters | same |
| 2026-08-29 | A minted worker token was committed to this public repo; revoked immediately (inert in one `UPDATE`, no JWT-secret rotation) and the mint script now writes outside any git tree | same |
| 2026-08-29 | Wired CD: the Vercel project is now connected to GitHub, so `main` auto-deploys and PRs get previews. Also dropped the one-argument `request_instance_deletion` overload, which set instances to `deleting` and queued no work — 52 delete requests since 08-10 had produced zero delete operations — and revoked a worker token that leaked into this public repo (inert immediately; revocation is one UPDATE by design) | — |
| 2026-08-29 | Confirmed and removed the orphaned VM 111 the delete fault left running on podF, plus five stale cloud-init snippets (three carrying auth keys) on the shared NFS export; logged **G-25**, the worker binding Tailscale devices by hostname, which misattributes private access and defeats teardown on a hostname collision | `docs/dev-log/2026-08-29-task-7-boundary-and-two-production-faults.md` |
| 2026-08-29 | Ran the Task 12 end-to-end lifecycle test on a disposable instance and found two production faults: instance creation was impossible on every cluster/image/plan (both admission gates required `monitoring_healthy`, which the worker reports false by design), and **deleting an instance provisioned a new VM instead of deleting it** (delete operations were seeded with create-shaped stages). Both fixed and applied (PR #17). Create, private access, snapshot, restore-replace and upward resize all verified against real hardware | `docs/dev-log/2026-08-29-task-7-boundary-and-two-production-faults.md` |
| 2026-08-29 | Revoked `anon` EXECUTE on three SECURITY DEFINER functions flagged by the security advisor (PR #16) | same |
| 2026-08-29 | Task 7: cluster-scoped worker RPC boundary (PR #15). New `guildcloud_site_worker` role with no table privileges, `worker_identities` mapping each worker to one cluster, and `worker_*` RPCs replacing every direct table access. Cluster resolved from the database, never the token. Cutover runbook and token-minting script included; service-role key not yet removed | `docs/runbooks/2026-08-29-worker-service-role-cutover.md` |
| 2026-08-29 | Repaired CI (PR #14). It had never passed since being introduced: `npm ci` failed on an `@types/node` conflict and a lockfile out of sync with package.json, so no job ever reached a test | — |
| 2026-08-29 | Platform hardening plan, first commit (`a3b9744`, PR #11): atomic lifecycle RPCs replacing RLS-blocked table writes, one-active-operation index, UPID-awaiting snapshot/restore, monotonic verified resize, real CI + ESLint flat config + `proxy.ts`, duplicate Guild-A worker collapsed to a tombstone. Restore-to-new removed | `docs/2026-08-29-guildcloud-platform-hardening-and-launch.md` |
| 2026-08-29 | Audited that plan against the repo and recorded honest per-task status in it (54 of its checkboxes verified done; capability contract found orphaned, lifecycle intent found unaudited, worker service-role key found still in place) | same plan doc |
| 2026-08-27 | Restored the ability to create instances at all (G-24): the wizard's admission gate was far stricter than the RPC that actually places VMs, and the Guild-B worker lacked `VM.Clone` on per-node templates (pool membership did *not* grant it). Added per-node ceiling overrides for podB–podF (podA and Guild-A deliberately untouched) plus explicit template ACLs; verified with two real end-to-end creates on podB and podD | `docs/dev-log/2026-08-27-guild-b-pod-admission-and-clone-acls.md` |
| 2026-08-27 | Pointed a new Cloudflare-DNS domain (`cloud.guild-technologies.com`) at the real Vercel prod deployment; found and fixed two real bugs in the separate self-hosted `guildcloud-console.guild-technologies.com` route on the Guild-A ingress box (stale dead-host IP causing a 502, then a wrong port pointed at the fleet-worker process instead of the Next.js portal) | `docs/dev-log/2026-08-27-custom-domain-and-ingress-route-fix.md` |
| 2026-08-25 | Deleted `lib/mock-data.ts` and every fabricated surface (4,938 lines removed): real identity in the topbar/dashboard, real sites via a new `list_admittable_sites()` RPC, honest "Coming soon" states for the 9 unbuilt features, real billing figures. Fixed alongside it: enrollment link re-minted on every click (~3s → ~900ms, and it no longer silently retires a link the member may have saved), no route to enroll a second device once enrolled, dark-mode-invisible step numerals, stale onboarding copy | — |
| 2026-08-25 | First real production deployment: `guildcloud-console.vercel.app` had no deployment at all until today (`DEPLOYMENT_NOT_FOUND`) — linked a real Vercel project, set env vars, deployed; fixed Supabase Auth's stale `localhost:3000` Site URL/missing Redirect URL that was breaking Google sign-in from any other machine; verified live end-to-end on the real production domain (sign-in, create instance, ready, delete) | — |
| 2026-08-25 | One-click device enrollment: "Enroll device →" guide link now auto-triggers command generation (was a plain nav link requiring a second click); enrollment links made reusable (90-day authkey); enroll script now runs `tailscale up --reset` to fix a real re-enrollment error; verified live on a real laptop | — |
| 2026-08-25 | Closed G-01 for real: shipped the tailnet wildcard-grant removal (PR #7, #8), verified live by direct re-read; confirmed generic worker deploy + `placement_settings.mode='multi'` already live (done by other sessions, undocumented until now); ran PBS GC to unblock Guild-B (9.73 GiB freed); cleaned up one 4-day-stuck orphaned instance | `docs/decisions/2026-08-22-tailnet-wildcard-grants-and-drift.md` |
| 2026-08-22 | Guild-B clones moved to local-lvm (`a404de5`); PBS one-off + failed-stub backups deleted (GC still needed); tailnet wildcard grants found still live, corrected policy drafted | `docs/decisions/2026-08-22-tailnet-wildcard-grants-and-drift.md` |
| 2026-08-19 | Multi-cluster placement Tasks 4-8 (code); Guild-B PBS fingerprint fix, siteworker identity, template backup+restore onto podA | `docs/dev-log/2026-08-19-guild-b-onboarding-day-1.md` |
| 2026-08-18 | Multi-cluster placement Tasks 1-3 (policy, schema, atomic RPC) | commits `453d2a5`..`8018f14` |
| 2026-08-14 | Real device self-enrollment, real invite email, real access grants, SSH key retroactive push, network-attach root cause fix | `docs/dev-log/2026-08-14-*.md` |
| 2026-08-10 | Worker self-deploy mechanism, live worker fix, catalog availability hardening, vault delete-secret bug | `docs/dev-log/2026-08-10-*.md` |
| 2026-08-09 | Phase 3 slice 1 (Tailscale private access), full phase-by-phase e2e test, warm pool for faster provisioning | `docs/dev-log/2026-08-09-*.md` |

## What's next

The hardening plan is now the active workstream; the items below it are the
older infrastructure backlog, still open and still real.

1. **Run the worker cutover** (`docs/runbooks/2026-08-29-worker-service-role-cutover.md`).
   Everything except the token is now in place on both boxes. What remains is
   minting one (needs the project JWT secret, deliberately kept away from any
   agent), pasting it into `/etc/guildcloud/worker.env` with
   `CONTROL_PLANE_AUTH_MODE=worker_token` and the service-role key removed, then
   rotating that key. Start with **Guild-B** — narrower surface. HS256 minting is
   confirmed to still work despite the project having an ES256 signing key, but
   **do not revoke the legacy key** while workers run on minted tokens, and check
   what else holds the service-role key before rotating (the Vercel deployment
   may).
2. **Wire the capability contract into the UI and server actions** (plan Task 3)
   so `lib/platform-capabilities.ts` enforces rather than documents, and fix the
   two stale copy strings plus the missing `docs/content/product-claims.md`.
3. **Add audit events to the five request RPCs** (plan Task 4) — customer
   lifecycle intent is currently unaudited. The cluster-ownership gap noted
   earlier is closed: `worker_finish_operation` now performs that check.
4. **Task 1 — restore a reproducible baseline schema**, before Tasks 9 and 10
   add more migrations to a schema the repo can't rebuild.
5. **Bounded-lease reconciliation** for operations stranded in `running`
   (plan Task 5) — reachable today, since snapshots/restore are enabled.
6. **Forgot-password and MFA** (plan Task 8) — neither route exists.

Older infrastructure backlog, unchanged:

7. **Durable fix for the PBS disk-space issue**: tighten retention on the
   large legacy guests (vm/600, vm/122, vm/100/120/200) so the 2026-08-22
   ENOSPC incident doesn't recur — today's GC only bought back headroom,
   it didn't change what's growing.
8. **Build the per-project membership concept** that would let
   `access_grants` actually enforce something — right now an enrolled
   member reaches every project in their org regardless of what the
   Access policy card shows (schema change, not an ACL change; G-01's
   network-level fix doesn't touch this).
9. **Remove the hardcoded storage values** in
   `deploy/site-worker/health-snapshot.js:61` (`guild-templates` reported
   as a flat 1TB/10GB) — placement scoring is currently working around
   this, not using it, but it's misleading dead-looking-live code.
10. Guild-B backup job (§2.8 of the plan) — not started yet.
11. Investigate why the 3 failed Guild-B create attempts on podF
   (2026-08-21) never got a useful cleanup/retry path — the stuck
   `state: deleting` instance found today suggests the deletion path has
   a gap for instances whose create failed with a VMID already allocated.
12. Fan out/build templates on more Guild-B nodes (podE has one now —
   `ui-test-guild-b-vm` landed there — but only opportunistically; not a
   deliberate fan-out), or land the deferred shared-NFS-template-storage
   work above so per-node templates aren't needed at all.
13. A deliberate, repeatable real UI end-to-end test (create → verify
   placement → full lifecycle → clean up) now that the infrastructure
   actually supports it without manual intervention.
14. **Wire up CD for the production deployment** (test CI now exists, deploy
    does not): right now `vercel --prod`
   is a manual step run from a session — no GitHub → Vercel git integration,
   no Actions workflow. `main` and production will drift again the moment
   someone pushes without remembering to redeploy.

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
