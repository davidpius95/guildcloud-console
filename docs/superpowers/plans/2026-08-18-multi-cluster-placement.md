# GuildCloud Multi-Cluster Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provision customer instances across Guild-A and Guild-B by atomically selecting one eligible cluster and node while preserving the existing Guild-A customer flow.

**Architecture:** Supabase remains the placement authority: cluster workers publish health and capacity, then a locked SQL function assigns one pending create operation and creates its reservation. One cluster-neutral Node worker runs per Proxmox cluster, validates its configured identity, and routes all create and lifecycle calls through the cluster/node stored on the operation or instance.

**Tech Stack:** PostgreSQL/Supabase migrations and RPCs, Node.js 22 ESM worker, Node built-in test runner, Next.js 16 server actions, Proxmox VE API, Tailscale API, systemd timers.

**Spec:** `docs/superpowers/specs/2026-08-18-multi-cluster-placement-design.md`

## Global Constraints

- Keep customer site `lag-1` distinct from execution clusters `guild-a` and `guild-b`.
- Do not expose Proxmox hosts, tokens, node names, or cluster credentials to customer clients.
- Keep at least 30% memory and storage reserve and cap configured vCPU at 70% on every admitted candidate.
- Never reassign an operation after a Proxmox side effect or VMID has been recorded.
- Backfill every existing instance and operation to Guild-A without migrating a VM.
- Keep Guild-B admission closed until its real Ubuntu clone, private SSH, lifecycle, and cleanup checks pass.
- Use separate least-privilege Proxmox credentials and root-only environment files for each cluster.
- Run schema, worker, type, build, shadow, forced-placement, automatic-placement, and rollback checks before closing G-23.

---

## Task 1: Add the Worker Unit-Test Harness and Pure Placement Policy

**Files:**
- Modify: `package.json`
- Modify: `deploy/site-worker-guild-a/package.json`
- Create: `deploy/site-worker/placement-policy.js`
- Create: `deploy/site-worker/placement-policy.test.js`

**Interfaces:**

```js
export function evaluateCandidate(candidate, request, now) {}
export function rankCandidates(candidates, request, now) {}
```

- [ ] Add root scripts `test:worker` and `test` that run `node --test deploy/site-worker/*.test.js`.
- [ ] Write failing tests for stale cluster heartbeat, stale node/storage observations, closed admission, offline nodes, missing capability, disabled prerequisites, and target-node mismatch.
- [ ] Run `npm run test:worker`; expect failures because the policy module does not exist.
- [ ] Implement hard-gate evaluation with structured rejection reasons.
- [ ] Add failing tests for the 30% RAM/storage reserve, 70% vCPU cap, held reservations, and `max(used_memory, committed_memory)`.
- [ ] Implement capacity calculations with integer byte/vCPU arithmetic.
- [ ] Add failing tests for score weights, warm-pool bonus, and deterministic cluster/node tie-breaking.
- [ ] Implement scoring/ranking and return a non-secret decision object.
- [ ] Run `npm run test:worker`; expect all policy tests to pass.
- [ ] Commit with `git commit -m "test: define multi-cluster placement policy"`.

## Task 2: Add Cluster, Node, Storage, Capability, and Placement Schema

**Files:**
- Create: `supabase/migrations/20260818090000_add_multi_cluster_placement.sql`
- Create: `supabase/tests/multi_cluster_placement_schema.sql`
- Modify: `package.json`

**Interfaces:**

```sql
public.infrastructure_clusters
public.infrastructure_nodes
public.infrastructure_storage_targets
public.catalog_image_cluster_templates
public.placement_settings
```

- [ ] Write pgTAP assertions for table/column keys, admission checks, foreign keys, cluster-scoped VMID uniqueness, and denied `anon`/`authenticated` writes.
- [ ] Add nullable `cluster_id`, `assigned_node`, `storage_id`, and `placement_decision` fields to `operations` as specified.
- [ ] Add `cluster_id` to `instances` and replace global VMID uniqueness with `(cluster_id, proxmox_vmid)` for non-null VMIDs.
- [ ] Add cluster/node/storage identity to `capacity_reservations` and `warm_pool_vms`; replace warm-pool VMID uniqueness with `(cluster_id, proxmox_vmid)`.
- [ ] Create admission tables with freshness timestamps, prerequisite booleans, configured commitments, and row-level security.
- [ ] Create cluster-level template capabilities with tested target nodes and clone mode.
- [ ] Add `placement_settings.mode` constrained to `single`, `shadow`, or `multi`, initially `single`.
- [ ] Backfill existing operations, instances, reservations, and warm-pool rows to `guild-a`; seed Guild-A in paused/single-safe form without changing live routing.
- [ ] Preserve `catalog_image_site_templates` as the compatibility read path during rollout.
- [ ] Add `test:db` using `supabase test db`; run it against a local reset and expect all pgTAP assertions to pass.
- [ ] Run `supabase db reset`, `npm run test:db`, and `npm run typecheck`.
- [ ] Commit with `git commit -m "feat: add multi-cluster placement schema"`.

## Task 3: Implement the Atomic Placement RPC

**Files:**
- Create: `supabase/migrations/20260818100000_add_atomic_placement_rpc.sql`
- Create: `supabase/tests/multi_cluster_placement_rpc.sql`

**Interfaces:**

```sql
public.place_next_pending_operation(
  p_worker_cluster_id text,
  p_now timestamptz default clock_timestamp(),
  p_force_cluster_id text default null
) returns uuid
```

- [ ] Write failing tests that seed two clusters and prove oldest-first selection, site filtering, image capability filtering, target-node filtering, and deterministic scoring.
- [ ] Write failing tests for stale heartbeat/capacity, paused/draining resources, failed private-network/backup/monitoring gates, RAM/disk reserve, vCPU ceiling, and active reservations.
- [ ] Implement candidate construction, hard-gate rejection JSON, scoring, and row locking with `FOR UPDATE SKIP LOCKED`.
- [ ] Lock the selected node and storage rows, recalculate capacity under lock, write operation/instance placement, and insert one reservation in the same transaction.
- [ ] Mark `preflight` and `capacity_reservation` complete only when placement commits.
- [ ] Leave an ineligible operation pending and store a customer-safe wait reason without creating a reservation.
- [ ] Implement `single` mode as Guild-A-only, `shadow` mode as recorded recommendation plus Guild-A assignment, and `multi` mode as the real winner.
- [ ] Restrict execution to service role and revoke it from `PUBLIC`, `anon`, and `authenticated`.
- [ ] Add a two-session SQL concurrency test proving one operation cannot be assigned twice and the last safe capacity cannot be oversubscribed.
- [ ] Run `supabase db reset && npm run test:db`; expect all schema, policy, and concurrency tests to pass.
- [ ] Commit with `git commit -m "feat: add atomic cluster placement"`.

## Task 4: Convert the Guild-A Worker into a Cluster-Neutral Worker

**Files:**
- Create: `deploy/site-worker/index.js`
- Create: `deploy/site-worker/config.js`
- Create: `deploy/site-worker/config.test.js`
- Create: `deploy/site-worker/routing.js`
- Create: `deploy/site-worker/routing.test.js`
- Create: `deploy/site-worker/package.json`
- Modify: `deploy/site-worker-guild-a/index.js`
- Modify: `supabase/functions/site-worker-guild-a/index.ts`

**Interfaces:**

```js
export function loadWorkerConfig(env) {}
export function assertOperationOwnership(operation, clusterId) {}
export function executionTarget(operation, instance) {}
```

- [ ] Write failing configuration tests for missing/invalid `WORKER_CLUSTER_ID`, `WORKER_SITE_ID`, `PVE_HOST`, `PVE_PORT`, `PVE_TOKEN_SECRET_NAME`, `PVE_POOL_ID`, and warm-pool settings.
- [ ] Implement validated configuration with no cluster host, token-secret, or node default.
- [ ] Write failing routing tests proving each lifecycle kind uses stored cluster/node and rejects cross-cluster work.
- [ ] Move canonical worker logic to `deploy/site-worker/index.js`; replace `NODE`, hardcoded host, token secret, site query, pool constants, and template lookup with configuration and placement fields.
- [ ] Make unassigned create operations unclaimable; invoke placement before claiming assigned work.
- [ ] Query only `operations.cluster_id = WORKER_CLUSTER_ID`; preserve existing retry and cleanup semantics.
- [ ] Route deletion, resize, snapshot, restore, SSH synchronization, and warm-pool claims through instance/operation cluster and node.
- [ ] Keep `deploy/site-worker-guild-a/index.js` as a temporary compatibility launcher importing the generic entrypoint.
- [ ] Update the Deno reference copy or replace it with a tracked notice pointing to the canonical generic source so it cannot silently diverge.
- [ ] Run `npm run test:worker`, `npm run typecheck`, and `npm run build`.
- [ ] Commit with `git commit -m "refactor: make site worker cluster neutral"`.

## Task 5: Publish Health, Capacity, Capability, and Long-Task Heartbeats

**Files:**
- Create: `deploy/site-worker/health-snapshot.js`
- Create: `deploy/site-worker/health-snapshot.test.js`
- Modify: `deploy/site-worker/index.js`
- Create: `supabase/migrations/20260818110000_add_worker_health_rpc.sql`
- Modify: `supabase/tests/multi_cluster_placement_rpc.sql`

**Interfaces:**

```js
export async function collectClusterSnapshot({ pve, config, now }) {}
public.publish_cluster_snapshot(p_cluster_id text, p_snapshot jsonb) returns void
public.touch_worker_heartbeat(p_cluster_id text, p_worker_id text) returns void
```

- [ ] Write failing parser tests for Proxmox cluster resources, configured guest memory/vCPU, shared Ceph storage, local storage, offline nodes, and incomplete responses.
- [ ] Implement snapshot collection without counting shared storage once per node.
- [ ] Add service-role-only RPCs that reject a snapshot whose cluster identity differs from the configured caller argument or contains unknown nodes/storage.
- [ ] Publish worker heartbeat every 20 seconds independently of capacity refresh.
- [ ] Keep heartbeat renewal active during Proxmox task waits, guest-agent waits, network attachment, and automated verification.
- [ ] Refresh full capacity at loop start and after reservation commit/release or VM deletion.
- [ ] Record prerequisite and template capability health without treating raw Proxmox `online` as operator admission.
- [ ] Run worker and database tests, then inject a delayed fake Proxmox task and prove heartbeat age remains below 60 seconds.
- [ ] Commit with `git commit -m "feat: publish cluster capacity and worker health"`.

## Task 6: Make Control-Plane Writes Preserve Placement

**Files:**
- Modify: `app/console/instances/actions.ts`
- Modify: `lib/supabase/queries.ts`
- Modify: `lib/supabase/types.ts`
- Create: `supabase/migrations/20260818120000_route_lifecycle_by_instance.sql`
- Create: `supabase/tests/multi_cluster_lifecycle.sql`

- [ ] Read the relevant Next.js 16 server-action and cache/revalidation guides under `node_modules/next/dist/docs/` before editing server actions.
- [ ] Add SQL tests proving lifecycle operations copy `cluster_id` and `proxmox_node` from the instance and cannot be inserted with a conflicting cluster.
- [ ] Keep create requests cluster-null and site-scoped so placement owns assignment.
- [ ] Change template pre-validation from one site-level row to “at least one currently enabled cluster capability in this customer site,” while retaining a safe compatibility fallback during single-mode deployment.
- [ ] Ensure resize, snapshot, restore-replace, restore-new, deletion, and SSH-key dirty work retain the original instance placement.
- [ ] Update typed query results to include placement internally without exposing cluster/node on customer cards.
- [ ] Run `npm run test`, `npm run test:db`, `npm run typecheck`, and `npm run build`.
- [ ] Commit with `git commit -m "feat: preserve placement across instance lifecycle"`.

## Task 7: Package Idempotent Per-Cluster Worker Deployment

**Files:**
- Create: `deploy/site-worker/guildcloud-worker.service`
- Create: `deploy/site-worker/guildcloud-worker.timer`
- Create: `deploy/site-worker/guildcloud-worker-deploy.service`
- Create: `deploy/site-worker/guildcloud-worker-deploy.timer`
- Create: `deploy/site-worker/deploy-pull.sh`
- Create: `deploy/site-worker/env.example`
- Create: `deploy/site-worker/README.md`
- Modify: `deploy/site-worker-guild-a/README.md`

- [ ] Parameterize systemd units and deploy-pull validation so the same package runs on both clusters.
- [ ] Require a root-only environment file and fail before startup if ownership/mode or required variables are unsafe.
- [ ] Make deployment atomic: download to a staging directory, install locked dependencies, run tests/syntax checks, switch the release symlink, and restart; retain the last known-good release.
- [ ] Add a dry-run command that prints only non-secret identity/configuration fields.
- [ ] Document exact Guild-A and Guild-B environment variable names, Vault secret names, service status, logs, rollback, and admission pause commands without secret values.
- [ ] Test install and rollback in a disposable local directory with fake environment and API responses.
- [ ] Commit with `git commit -m "ops: package generic cluster worker deployment"`.

## Task 8: Deploy Guild-A in Single Mode and Prove No Regression

**Files:**
- Modify: `docs/phase-2/operator-runbook.md`
- Create: `docs/dev-log/2026-08-18-guild-a-generic-worker-parity.md`

- [ ] Take read-only Guild-A preflight snapshots: cluster quorum, node/storage health, worker LXC 500 state, current worker revision, timer status, pending operations, and the existing disposable instance.
- [ ] Apply migrations to the linked Supabase project and verify backfilled Guild-A placement and grants.
- [ ] Deploy the generic worker to Guild-A with `WORKER_CLUSTER_ID=guild-a` while placement mode remains `single`.
- [ ] Verify timer cadence, independent heartbeat, capacity snapshot freshness, template capabilities, and no cross-cluster claim possibility.
- [ ] Create one disposable Ubuntu Standard 1 instance through the real UI, observe all 10 stages, and verify its DB placement matches its Proxmox VM/node.
- [ ] Verify private hostname, key SSH, password SSH reveal/login, guest agent, monitoring, backup registration, snapshot, restore, resize, and deletion.
- [ ] Confirm Proxmox VM, Tailscale device, reservation, and transient secret cleanup.
- [ ] Record IDs, timestamps, stage durations, cleanup evidence, and any deviation in the dev log without credentials.
- [ ] Switch to `shadow`, create one additional disposable request, compare recorded candidate with live capacity, clean it up, and return to `single` if any mismatch appears.
- [ ] Commit with `git commit -m "docs: record Guild-A generic worker parity"`.

## Task 9: Onboard Guild-B with Admission Closed

**Files:**
- Create: `deploy/site-worker/guild-b.env.example`
- Modify: `docs/phase-2/operator-runbook.md`
- Create: `docs/dev-log/2026-08-18-guild-b-worker-onboarding.md`

- [ ] Perform harmless live reads of Guild-B quorum, pod capacity, storage, template 9000, networking, PBS job/namespace, monitoring, and current workloads.
- [ ] Choose one management node for a small dedicated worker LXC and only nodes whose post-placement capacity preserves the 30% reserve.
- [ ] Create a dedicated least-privilege Guild-B Proxmox role/user/token; store the token in a Guild-B-specific Supabase Vault secret without printing it.
- [ ] Provision the worker LXC with an explicit create-time infrastructure approval gate, install the generic worker, and verify root-only environment permissions.
- [ ] Keep cluster/node/storage admission `paused` while publishing heartbeat and read-only capacity.
- [ ] Build or validate a clean Ubuntu GuildCloud template and test local clone paths one node at a time; admit only target nodes with real evidence.
- [ ] Validate cloud-init, guest agent, Tailscale enrollment, private DNS, SSH key/password modes, monitoring, PBS backup/restore, and deletion on a disposable non-customer VM.
- [ ] Seed only the verified Guild-B Ubuntu capability, storage targets, and node allowlist; leave every other image Guild-A-only.
- [ ] Record exact admitted nodes and rejected-node reasons, then commit with `git commit -m "ops: onboard Guild-B worker with admission closed"`.

## Task 10: Prove Forced Guild-B Placement and Lifecycle

**Files:**
- Create: `docs/dev-log/2026-08-18-guild-b-provisioning-e2e.md`
- Modify: `docs/phase-2/operator-runbook.md`

- [ ] Keep global mode `single`; use the service-role-only forced-cluster test argument for exactly one named disposable operation.
- [ ] Create the operation through the actual UI, force it to `guild-b`, and verify the Guild-A worker cannot claim it.
- [ ] Observe every operation stage and match operation/instance cluster, node, storage, VMID, Proxmox task, and capacity reservation.
- [ ] Verify private IP/hostname, Tailscale ACL state, key SSH, password SSH, guest-agent command, monitoring, and backup registration.
- [ ] Run resize, snapshot, restore, and deletion; confirm every API call remains on Guild-B and the stored node.
- [ ] Confirm the Guild-B VM, Tailscale device, reservation, temporary secret, snapshot records, and operation artifacts are cleaned according to policy.
- [ ] Pause the selected node and prove a new forced request produces no Proxmox side effect.
- [ ] Record evidence and commit with `git commit -m "test: prove Guild-B provisioning and lifecycle"`.

## Task 11: Enable and Test Automatic Two-Cluster Placement

**Files:**
- Create: `scripts/verify-multi-cluster-placement.mjs`
- Create: `docs/dev-log/2026-08-18-multi-cluster-placement-e2e.md`
- Modify: `docs/phase-2/operator-runbook.md`

- [ ] Add a read-only verification script that reports heartbeat/capacity ages, admitted capabilities, reservations, placement decisions, and cluster-qualified VMIDs without secrets.
- [ ] Capture a clean baseline and switch placement mode from `shadow` to `multi` for Ubuntu Standard 1 only.
- [ ] Create controlled disposable operations through the UI and verify automatic selection matches the highest-ranked eligible candidate.
- [ ] Adjust only reversible admission switches to force one real automatic placement on each cluster; do not fake capacity values.
- [ ] Simulate stale heartbeat, paused cluster, draining node, missing capability, and exhausted reserve; prove each request remains pending with no Proxmox side effect.
- [ ] Run concurrent create requests and verify reservations keep both node and storage above reserve.
- [ ] Switch `multi` to `single`, prove new creates return to Guild-A, and prove an existing Guild-B instance still receives lifecycle operations from Guild-B.
- [ ] Restore `multi` only after rollback behavior passes; otherwise leave `single` and document the blocker.
- [ ] Clean up all disposable instances and confirm both clusters, Tailscale, Supabase reservations, and Vault contain no test residue.
- [ ] Commit with `git commit -m "test: verify automatic multi-cluster placement"`.

## Task 12: Close Documentation, Build, and Release Gates

**Files:**
- Modify: `docs/phase-0/gap-register.md`
- Modify: `docs/phase-2/data-model.md`
- Modify: `docs/phase-2/api-contract.md`
- Modify: `docs/phase-2/threat-model.md`
- Modify: `docs/phase-2/operator-runbook.md`
- Modify: `docs/superpowers/specs/2026-08-18-multi-cluster-placement-design.md`

- [ ] Update Phase 2 documentation with real table/RPC contracts, security grants, worker configuration, admission, incident response, capacity, and rollback procedures.
- [ ] Link Guild-A parity, Guild-B onboarding, Guild-B lifecycle, and automatic-placement evidence from G-23.
- [ ] Mark G-23 resolved only if one real UI-created instance reached Ready, passed private SSH, completed lifecycle checks, and was cleaned up on each cluster.
- [ ] Run `npm test`, `npm run test:db`, `npm run typecheck`, and `npm run build` from a clean dependency install.
- [ ] Compare canonical worker and both deployed release hashes; verify both services and timers are healthy.
- [ ] Run the multi-cluster verification script and a final UI smoke test on desktop and mobile widths.
- [ ] Run `rg -n "TEMPORARY|NOT_IMPLEMENTED|guild-a.*hardcod|const NODE|192\\.168\\.8\\.195" deploy/site-worker app lib supabase docs/phase-2` and resolve any unfinished marker or unintended hardcoding.
- [ ] Verify `git diff --check`, review `git status`, inspect the complete diff, and confirm no secret or environment file is tracked.
- [ ] Commit with `git commit -m "docs: close multi-cluster placement gap"` and push the branch after all gates pass.
