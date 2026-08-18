# GuildCloud Multi-Cluster Placement Design

**Date:** 2026-08-18  
**Status:** Proposed for implementation  
**Scope:** Phase 2 site integration, gap G-23  
**Applies to:** Guild-A and Guild-B provisioning beneath the current Lagos site

## 1. Objective

GuildCloud must provision customer instances across Guild-A and Guild-B and
select an eligible node automatically. The customer experience remains the
same as the current Guild-A flow: the customer selects a site, image, plan,
protection tier, and access method, then watches one durable operation until
the instance is Ready.

Customers do not select or communicate with Proxmox clusters or nodes.
Placement is an internal control-plane decision recorded for operations,
support, billing, and audit.

## 2. Infrastructure Meaning

The system must stop treating these concepts as interchangeable:

- **Customer site:** a physical failure and commercial location shown in the
  console. Guild-A and Guild-B are currently in the same Lagos building,
  network, gateway, and power domain, so both belong to `lag-1`.
- **Execution cluster:** an independent Proxmox cluster with separate API
  credentials, workers, VMID namespace, templates, storage, and admission
  state. Initial values are `guild-a` and `guild-b`.
- **Execution node:** the Proxmox node selected inside a cluster, such as
  `nodeB` or `podF`.

Guild-B increases usable capacity and cluster diversity. It must not be
described as geographic redundancy or mapped to the fictional Abuja site.

## 3. Requirements

1. A create request can be assigned to either Guild-A or Guild-B.
2. Placement chooses exactly one cluster and one node atomically.
3. Two concurrent requests cannot reserve the same final capacity.
4. The selected cluster must have a healthy worker and a tested template for
   the requested image.
5. The selected node and storage domain must retain the plan's 30% reserve
   after placement.
6. Workers may process only operations assigned to their own cluster.
7. Every Proxmox action after placement uses the instance's stored cluster and
   node, including resize, snapshot, restore, deletion, and cleanup.
8. Existing Guild-A instances remain on Guild-A; this change does not migrate
   them.
9. A failed worker or cluster must not cause an operation with Proxmox side
   effects to be silently reassigned to another cluster.
10. The system must support adding a future cluster without copying or
   rewriting the worker.

## 4. Non-Goals

- Geographic disaster recovery. Both initial clusters share one physical
  site.
- Live migration between Guild-A and Guild-B.
- Automatic cross-cluster failover of a stateful VM.
- Making every image available on Guild-B on day one.
- Allowing customers to pick clusters or nodes.
- Replacing the current Tailscale private-access model.
- Solving the open tenant SDN isolation and external SNAT gaps.

## 5. Architecture

Each cluster runs one generic GuildCloud site-worker configured with a cluster
identity and cluster-specific credentials. Both workers run the same tracked
source and lifecycle contract.

The worker loop has three responsibilities:

1. Publish fresh cluster, node, storage, template, and worker health snapshots.
2. Invoke an atomic database placement function for pending unassigned create
   operations.
3. Process only operations assigned to the worker's configured cluster.

The database is the placement authority. Workers provide live observations;
the database transaction makes the single durable decision and creates the
capacity reservation. This avoids a separate scheduler service while
preventing two workers from racing to own the same request.

## 6. Data Model

### 6.1 `infrastructure_clusters`

One row per Proxmox cluster:

| Column | Purpose |
| --- | --- |
| `id` | Stable key: `guild-a`, `guild-b` |
| `site_id` | Customer site, initially `lag-1` for both clusters |
| `name` | Operator label |
| `enabled` | Global scheduling switch |
| `admission_state` | `open`, `draining`, or `paused` |
| `worker_heartbeat_at` | Last successful worker heartbeat |
| `capacity_observed_at` | Last complete capacity snapshot |
| `failure_reason` | Operator-visible reason when paused |

Only service-role workers and operators may modify this table. Authenticated
customers receive no direct access.

### 6.2 `infrastructure_nodes`

One row per cluster/node pair:

| Column | Purpose |
| --- | --- |
| `cluster_id`, `node` | Composite primary key |
| `enabled` | Explicit operator allowlist |
| `admission_state` | `open`, `draining`, or `paused` |
| `online` | Latest Proxmox status |
| `total_vcpu`, `committed_vcpu` | Physical and configured workload capacity |
| `total_memory_bytes`, `used_memory_bytes` | Current memory capacity |
| `cpu_utilization` | Scoring signal, not the primary capacity promise |
| `observed_at` | Freshness boundary |
| `failure_reason` | Why the node cannot accept work |

An online Proxmox node is not automatically admitted. Operators explicitly
enable nodes after template, storage, network, backup, monitoring, and legacy
workload checks pass.

### 6.3 `infrastructure_storage_targets`

Storage capacity is modeled separately because Guild-A uses shared Ceph while
Guild-B uses node-local storage.

| Column | Purpose |
| --- | --- |
| `cluster_id`, `storage_id` | Storage-domain identity |
| `node` | Null for shared storage; set for node-local storage |
| `enabled`, `healthy` | Admission gates |
| `shared` | Whether the target is reachable from multiple nodes |
| `total_bytes`, `used_bytes` | Latest capacity |
| `observed_at` | Freshness boundary |

Shared storage is counted once per storage domain, not once per node.

### 6.4 `catalog_image_cluster_templates`

The current `(catalog_image_id, site_id)` mapping cannot represent two
clusters in one site. Replace it as the placement source with:

| Column | Purpose |
| --- | --- |
| `catalog_image_id`, `cluster_id` | Template capability identity |
| `source_node`, `proxmox_vmid`, `storage_id` | Clone source |
| `target_nodes` | Nodes on which the tested clone path is valid |
| `clone_mode` | `linked` or `full` |
| `enabled`, `tested_at` | Admission and evidence |
| `template_version` | Lifecycle/audit identity |

The existing site-level table remains readable during migration, then becomes
a compatibility view or is removed only after all callers move.

Guild-A initially exposes its currently tested catalogue. Guild-B initially
exposes Ubuntu only. Other images remain valid Guild-A candidates until an
equivalent Guild-B template passes the full provisioning and access tests.

### 6.5 Existing tables

Add the following placement fields:

- `operations.cluster_id` and `operations.assigned_node`, nullable until
  placement.
- `operations.placement_decision`, a non-secret JSON explanation containing
  candidate rejection reasons and the selected score.
- `instances.cluster_id`, populated when placement succeeds.
- `capacity_reservations.cluster_id`; uniqueness remains operation-scoped.
- `warm_pool_vms.cluster_id` and `node`; a warm VM is claimable only by an
  operation assigned to the same cluster and node-compatible storage path.

VMIDs are cluster-scoped. Any active uniqueness rule must use
`(cluster_id, proxmox_vmid)`, never `proxmox_vmid` alone.

## 7. Placement Transaction

The service-role-only function `place_next_pending_operation()` performs one
atomic placement:

1. Select the oldest unassigned pending create operation using
   `FOR UPDATE SKIP LOCKED`.
2. Load the requested plan, image, customer site, and existing unexpired
   reservations.
3. Build candidates from enabled clusters and nodes in that site.
4. Reject candidates that fail any hard gate.
5. Score the remaining candidates.
6. Lock the chosen node and storage rows.
7. Recalculate capacity while locks are held.
8. Write `operations.cluster_id` and `operations.assigned_node`.
9. Insert the capacity reservation with the same cluster/node/storage
   identity.
10. Record the decision and mark the placement/capacity stage complete.

If no candidate is eligible, the operation remains pending with a clear
customer-safe reason and operator detail. It is not assigned speculatively.

## 8. Eligibility Rules

A candidate must satisfy every hard gate:

- Cluster enabled and admission `open`.
- Worker heartbeat no older than 60 seconds.
- Complete capacity observation no older than 60 seconds.
- Node enabled, online, admission `open`, and observation fresh.
- Tested enabled template exists for the image and cluster.
- Node is included in the template's tested target nodes.
- Storage target is enabled, healthy, fresh, and reachable from the node.
- Private networking prerequisite is healthy.
- Backup prerequisite is healthy for the requested protection tier.
- Monitoring prerequisite is healthy.
- Requested RAM, vCPU, and disk fit after reservations.
- The 30% reserve remains after placement.

### Capacity calculations

For node memory:

`post_free_memory = total_memory - used_memory - held_memory - requested_memory`

The candidate passes only when:

`post_free_memory >= total_memory * 0.30`

For vCPU, the initial policy does not oversubscribe customer allocations:

`committed_vcpu + held_vcpu + requested_vcpu <= floor(total_vcpu * 0.70)`

For storage:

`post_free_storage = total_storage - used_storage - held_storage - requested_disk`

The candidate passes only when:

`post_free_storage >= total_storage * 0.30`

These rules are deliberately conservative. Future oversubscription or
storage-class policy requires measured evidence and a separate decision.

## 9. Candidate Score

Hard gates decide safety. Scoring decides among safe candidates.

The initial score is descending:

- 50% post-placement memory headroom percentage.
- 25% post-placement vCPU headroom percentage.
- 20% post-placement storage headroom percentage.
- 5% warm-pool match for the exact image and plan.

Ties are resolved by `cluster_id`, then node name, for deterministic behavior.
The decision JSON records each component so operators can explain placement.

The score does not override a hard gate. A high-capacity node with stale
monitoring, missing backup admission, or an untested template remains
ineligible.

## 10. Generic Worker

Replace cluster-specific constants with validated configuration:

- `WORKER_CLUSTER_ID`
- `WORKER_SITE_ID`
- `PVE_HOST`
- `PVE_PORT`
- `PVE_TOKEN_SECRET_NAME`
- `PVE_POOL_ID`
- `WARM_POOL_ENABLED`

The canonical tracked worker moves to a cluster-neutral path such as
`deploy/site-worker/index.js`. Guild-A and Guild-B deployment units invoke the
same source with different root-only environment files.

Every Proxmox API path must use the operation or instance's stored node. The
global `NODE` constant is removed. Template source node and selected target
node are distinct values.

Worker claim queries use `operations.cluster_id = WORKER_CLUSTER_ID`. A worker
must reject an operation whose cluster identity does not match, even when
running with a service-role key.

## 11. Guild-B Onboarding

Guild-B becomes eligible only after these gates pass:

1. Create a dedicated least-privilege Proxmox worker identity and token.
2. Store the token in Supabase Vault under a Guild-B-specific secret name.
3. Provision a small dedicated worker LXC on an admitted Guild-B management
   node after live capacity preflight.
4. Deploy the generic worker and systemd timer using the same deploy-pull
   contract as Guild-A.
5. Build or import a clean Ubuntu GuildCloud template using the tracked
   template process; do not reuse an unverified legacy template.
6. Verify the clone path to each node before adding that node to
   `target_nodes`.
7. Verify Tailscale enrollment, private DNS, SSH key and password modes,
   guest-agent execution, deletion, PBS namespace, and monitoring.
8. Open Guild-B admission only after the end-to-end disposable test is
   cleaned up and all evidence is recorded.

Because Guild-B storage is local, the scheduler may use only nodes with a
tested local template/clone path. It must not assume a template on `podA` can
be safely cloned to every other node.

## 12. Existing Instance Operations

Existing instances are backfilled with `cluster_id = 'guild-a'` and retain
their current `proxmox_node`.

Resize, snapshot, restore, SSH key synchronization, password access changes,
deletion, and cleanup route by the stored instance cluster and node. They never
invoke new placement.

An unplaced create operation may be retried by placement. Once
`proxmox_api_call` begins or a VMID is recorded, automatic cross-cluster
reassignment is forbidden. Recovery must resume or clean up on the original
cluster.

## 13. Security

- Guild-A and Guild-B use separate Proxmox identities and tokens.
- Worker environment files remain root-only.
- No cluster token is returned to the console or stored in customer tables.
- Database placement functions are service-role-only.
- Cluster/node health tables expose no management IPs or credentials to
  authenticated customers.
- Every placement and admission change produces an audit event.
- The service-role trade-off remains explicit; worker-side cluster checks are
  defense in depth, not a replacement for future scoped database identities.

## 14. Failure Behavior

- **Stale worker or capacity data:** candidate rejected; no placement.
- **No eligible candidate:** operation remains pending with a capacity or
  capability message; no Proxmox side effect.
- **Worker dies before Proxmox side effect:** reservation expires; placement
  may be safely reset and retried.
- **Worker dies after VM creation:** operation remains bound to its cluster and
  node; the same worker resumes when healthy.
- **Cluster paused:** no new placements; existing lifecycle and cleanup
  operations remain routable unless operators explicitly disable them.
- **Node draining:** no new placement; existing instances remain.
- **Template disabled:** new placement stops for that image/cluster; existing
  instances remain manageable.
- **Reservation expiry during active work:** the worker renews the reservation
  while the operation is running, then commits or releases it explicitly.

## 15. Observability

Operator-visible fields and logs must include:

- Operation ID, instance ID, site, cluster, node, storage, and worker identity.
- Placement candidate count and rejection reasons.
- Selected score components and reservation expiry.
- Capacity snapshot age.
- Proxmox task ID and VMID, always qualified by cluster.
- Stage duration, retry classification, and cleanup result.

Customer UI continues to show the customer site and operation stages. Cluster
and node are available only in operator/support detail unless a future product
decision exposes them.

## 16. Migration and Rollout

1. Add new tables and nullable placement columns without changing current
   behavior.
2. Seed Guild-A and backfill existing Guild-A instances and operations.
3. Deploy the generic worker to Guild-A in `single` placement mode and prove
   parity with one disposable instance and cleanup.
4. Enable health snapshots and placement shadow mode. Shadow mode records the
   candidate it would choose but leaves real operations on Guild-A.
5. Compare shadow decisions against live capacity and correct admission data.
6. Onboard Guild-B worker, template, nodes, storage, backup, monitoring, and
   private-access evidence with admission paused.
7. Force one disposable Ubuntu operation to Guild-B, verify Ready and remote
   SSH, then delete it and confirm Proxmox/Tailscale cleanup.
8. Enable automatic two-cluster placement for Ubuntu Standard 1 only.
9. Expand plans, nodes, and images incrementally after passing the same tests.
10. Close G-23 only after automatic placement has produced and cleaned up real
    instances on both clusters.

## 17. Rollback

Placement has an operator mode:

- `single`: assign new create operations only to Guild-A using the new data
  model.
- `shadow`: calculate and record a multi-cluster decision without using it.
- `multi`: use the atomic multi-cluster decision.

Rollback from `multi` to `single` stops new Guild-B placements but does not
move, orphan, or reroute existing Guild-B instances. The Guild-B worker remains
running for lifecycle operations and cleanup. Schema additions remain in place
because deleting cluster identity from existing instances would make them
unmanageable.

## 18. Verification

### Automated tests

- Placement rejects stale worker, node, storage, backup, monitoring, or
  template data.
- Placement enforces the 30% memory and storage reserves.
- Placement enforces the initial 70% vCPU allocation ceiling.
- Reservations are included in every capacity calculation.
- Two concurrent placement calls cannot assign the same operation twice or
  oversubscribe the last capacity.
- Capability filtering keeps non-Ubuntu images on Guild-A initially.
- Deterministic tie-breaking produces stable decisions.
- Every lifecycle operation routes by stored cluster and node.
- VMID uniqueness is cluster-scoped.
- A worker cannot claim another cluster's operation.

### Live acceptance

- Create one disposable Standard 1 Ubuntu instance forced to Guild-A.
- Create one disposable Standard 1 Ubuntu instance forced to Guild-B.
- Create automatic instances under controlled capacity conditions and verify
  the scheduler chooses the expected eligible node.
- Verify UI stages, Proxmox VM, private IP/hostname, Tailscale policy, key SSH,
  password SSH, guest-agent check, backup registration, and monitoring.
- Resize, snapshot, restore, and delete one instance on each cluster.
- Confirm deletion removes the correct cluster-qualified VMID and Tailscale
  device and releases capacity.
- Pause a node and cluster and prove no new operation is placed there.
- Simulate stale heartbeat and capacity exhaustion and verify no Proxmox side
  effect occurs.

## 19. Completion Criteria

The change is complete only when:

- Guild-A and Guild-B each run the generic worker from tracked source.
- Automatic placement selects an eligible cluster and node atomically.
- The 30% reserve and capability gates are enforced under concurrency.
- Existing Guild-A instances remain manageable.
- At least one disposable customer instance reaches Ready and passes private
  SSH on each cluster.
- Cross-cluster lifecycle and cleanup tests pass.
- Deployment, incident, capacity, and rollback runbooks are updated.
- The console remains honest about Lagos being one physical site.
- Gap G-23 contains links to the live evidence and can be marked resolved.
