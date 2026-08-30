-- Contract for the cluster-scoped worker RPC boundary (plan Task 7).
--
-- The property under test: a worker token proves *which* worker is calling, and
-- the database decides which cluster that worker may touch. A Guild-A worker
-- must not be able to read, advance, or finalize a Guild-B operation even though
-- it is calling the same functions with the same privileges.

begin;
select plan(62);

insert into public.worker_identities (worker_id, cluster_id, description) values
  ('worker-guild-a', 'guild-a', 'Guild-A site worker'),
  ('worker-guild-b', 'guild-b', 'Guild-B site worker'),
  ('worker-revoked', 'guild-a', 'decommissioned Guild-A worker');

update public.worker_identities set revoked_at = now() where worker_id = 'worker-revoked';

-- Exactly one worker holds the tailnet-wide housekeeping role.
update public.worker_identities set tailnet_housekeeping = true where worker_id = 'worker-guild-a';

-- One pending operation per cluster, each against that cluster's own instance.
insert into public.operations
  (id, organization_id, project_id, instance_id, site_id, cluster_id,
   assigned_node, kind, resource_name, state, idempotency_key)
values
  ('60000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000001',
   '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
   'lag-1', 'guild-a', 'nodeA', 'instance.snapshot', 'alpha-ready', 'pending', 'key-a'),
  ('60000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-000000000002',
   '30000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002',
   'lag-1', 'guild-b', 'podB', 'instance.snapshot', 'beta-ready', 'pending', 'key-b');

insert into public.operation_stages (operation_id, stage) values
  ('60000000-0000-4000-8000-00000000000a', 'proxmox_api_call'),
  ('60000000-0000-4000-8000-00000000000b', 'proxmox_api_call');

-- ---------------------------------------------------------------------------
-- The role itself holds no table privileges
-- ---------------------------------------------------------------------------

select ok(
  not exists (
    select 1
    from information_schema.role_table_grants
    where grantee = 'guildcloud_site_worker' and table_schema = 'public'
  ),
  'worker role has no table privileges in public'
);

select ok(
  not (select rolbypassrls from pg_roles where rolname = 'guildcloud_site_worker'),
  'worker role cannot bypass row-level security'
);

select ok(
  not (select rolsuper from pg_roles where rolname = 'guildcloud_site_worker'),
  'worker role is not a superuser'
);

-- The raw primitives still take a caller-supplied cluster, so the worker role
-- must not be able to reach them directly and re-open the hole.
select ok(
  not has_function_privilege('guildcloud_site_worker',
    'public.place_next_pending_operation(text, timestamptz, text)', 'execute'),
  'worker role cannot call place_next_pending_operation directly'
);

select ok(
  not has_function_privilege('guildcloud_site_worker',
    'public.publish_cluster_snapshot(text, jsonb)', 'execute'),
  'worker role cannot call publish_cluster_snapshot directly'
);

select ok(
  not has_function_privilege('guildcloud_site_worker',
    'public.finish_instance_operation(uuid, text, jsonb, text)', 'execute'),
  'worker role cannot call finish_instance_operation directly'
);

-- ---------------------------------------------------------------------------
-- Customers cannot reach the worker surface
-- ---------------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated', 'public.worker_claim_next_operation()', 'execute'),
  'authenticated cannot claim worker operations'
);

select ok(
  not has_function_privilege('anon', 'public.worker_claim_next_operation()', 'execute'),
  'anon cannot claim worker operations'
);

select ok(
  not has_function_privilege('authenticated', 'public.worker_finish_operation(uuid, text, jsonb, text)', 'execute'),
  'authenticated cannot finalize worker operations'
);

select ok(
  not has_function_privilege('authenticated', 'public.current_worker_cluster()', 'execute'),
  'authenticated cannot resolve a worker cluster'
);

-- ---------------------------------------------------------------------------
-- Identity resolution
-- ---------------------------------------------------------------------------

set local role guildcloud_site_worker;
set local "request.jwt.claims" = '{"role":"guildcloud_site_worker"}';

select throws_ok(
  $$ select public.current_worker_cluster() $$,
  '28000',
  'worker identity is required',
  'a token with no worker_id claim is rejected'
);

set local "request.jwt.claims" = '{"role":"guildcloud_site_worker","worker_id":"worker-unknown"}';

select throws_ok(
  $$ select public.current_worker_cluster() $$,
  '28000',
  'worker identity is not recognized',
  'an unregistered worker id is rejected'
);

set local "request.jwt.claims" = '{"role":"guildcloud_site_worker","worker_id":"worker-revoked"}';

select throws_ok(
  $$ select public.current_worker_cluster() $$,
  '28000',
  'worker identity is not recognized',
  'a revoked worker is rejected without rotating the JWT secret'
);

set local "request.jwt.claims" = '{"role":"guildcloud_site_worker","worker_id":"worker-guild-a"}';

select is(
  public.current_worker_cluster(),
  'guild-a',
  'a registered worker resolves to its mapped cluster'
);

-- The cluster is not read from the token: a worker that asserts another cluster
-- in its own claims still resolves to the one the database has on file.
set local "request.jwt.claims" =
  '{"role":"guildcloud_site_worker","worker_id":"worker-guild-a","cluster_id":"guild-b"}';

select is(
  public.current_worker_cluster(),
  'guild-a',
  'a cluster_id claim in the token cannot widen the worker scope'
);

-- ---------------------------------------------------------------------------
-- Cross-cluster refusal
-- ---------------------------------------------------------------------------

set local "request.jwt.claims" = '{"role":"guildcloud_site_worker","worker_id":"worker-guild-a"}';

select lives_ok(
  $$ select public.worker_get_operation('60000000-0000-4000-8000-00000000000a') $$,
  'a worker reads its own cluster operation'
);

select throws_ok(
  $$ select public.worker_get_operation('60000000-0000-4000-8000-00000000000b') $$,
  'P0002',
  'operation not found for this cluster',
  'a worker cannot read another cluster operation'
);

select throws_ok(
  $$ select public.worker_start_stage('60000000-0000-4000-8000-00000000000b', 'proxmox_api_call') $$,
  'P0002',
  'operation not found for this cluster',
  'a worker cannot start a stage on another cluster operation'
);

select throws_ok(
  $$ select public.worker_complete_stage('60000000-0000-4000-8000-00000000000b', 'proxmox_api_call', 'done') $$,
  'P0002',
  'operation not found for this cluster',
  'a worker cannot complete a stage on another cluster operation'
);

select throws_ok(
  $$ select public.worker_finish_operation('60000000-0000-4000-8000-00000000000b', 'succeeded') $$,
  'P0002',
  'operation not found for this cluster',
  'a worker cannot finalize another cluster operation'
);

-- ---------------------------------------------------------------------------
-- The identity, not the caller, supplies the cluster to the primitives
-- ---------------------------------------------------------------------------

select is(
  public.worker_claim_next_operation(),
  '60000000-0000-4000-8000-00000000000a'::uuid,
  'a worker claims only its own cluster pending work'
);

select lives_ok(
  $$ select public.worker_publish_snapshot('{"nodes":[]}'::jsonb) $$,
  'a worker publishes a capacity snapshot'
);

-- Reading the audit table needs privileges the worker role deliberately lacks,
-- so step out of the role to inspect what the primitives were actually called
-- with. That the worker cannot read it is itself asserted at the top of this file.
reset role;

select is(
  (select cluster_id from public.test_primitive_calls
   where fn = 'place_next_pending_operation' order by id desc limit 1),
  'guild-a',
  'the claim passes the identity cluster, not a caller-supplied one'
);

select is(
  (select cluster_id from public.test_primitive_calls
   where fn = 'publish_cluster_snapshot' order by id desc limit 1),
  'guild-a',
  'the snapshot publishes against the identity cluster'
);

set local role guildcloud_site_worker;

-- Guild-B's worker sees only Guild-B work from the identical call.
set local "request.jwt.claims" = '{"role":"guildcloud_site_worker","worker_id":"worker-guild-b"}';

select is(
  public.worker_claim_next_operation(),
  '60000000-0000-4000-8000-00000000000b'::uuid,
  'the other cluster worker claims only its own pending work'
);

-- ---------------------------------------------------------------------------
-- Stage transitions on an owned operation
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.worker_start_stage('60000000-0000-4000-8000-00000000000b', 'proxmox_api_call') $$,
  'a worker starts a stage on its own operation'
);

select throws_ok(
  $$ select public.worker_complete_stage('60000000-0000-4000-8000-00000000000b', 'proxmox_api_call', 'bogus') $$,
  '22023',
  'stage status must be active, done, failed, or skipped',
  'an unknown stage status is rejected'
);

reset role;

select is(
  (select status from public.operation_stages
   where operation_id = '60000000-0000-4000-8000-00000000000b' and stage = 'proxmox_api_call'),
  'active',
  'starting a stage records active status'
);

select is(
  (select state from public.operations where id = '60000000-0000-4000-8000-00000000000b'),
  'running',
  'starting a stage moves its operation to running'
);

-- ---------------------------------------------------------------------------
-- Slice B: instance runtime writes
-- ---------------------------------------------------------------------------

set local role guildcloud_site_worker;
set local "request.jwt.claims" = '{"role":"guildcloud_site_worker","worker_id":"worker-guild-a"}';

select lives_ok(
  $$ select public.worker_update_instance_runtime(
       '40000000-0000-4000-8000-000000000001',
       '{"proxmox_vmid": 777, "private_hostname": "alpha-ready"}'::jsonb) $$,
  'a worker records observed runtime facts on its own instance'
);

select throws_ok(
  $$ select public.worker_update_instance_runtime(
       '40000000-0000-4000-8000-000000000002', '{"proxmox_vmid": 778}'::jsonb) $$,
  'P0002',
  'instance not found for this cluster',
  'a worker cannot write runtime fields on another cluster instance'
);

-- The whitelist is the real protection: a worker that could set catalog_plan_id
-- could silently re-bill a customer, and one that could set organization_id
-- could move an instance between tenants.
select throws_ok(
  $$ select public.worker_update_instance_runtime(
       '40000000-0000-4000-8000-000000000001', '{"catalog_plan_id": "std-2"}'::jsonb) $$,
  '42501',
  $msg$column 'catalog_plan_id' is not worker-writable$msg$,
  'a worker cannot change the billed plan'
);

select throws_ok(
  $$ select public.worker_update_instance_runtime(
       '40000000-0000-4000-8000-000000000001',
       '{"organization_id": "10000000-0000-4000-8000-000000000002"}'::jsonb) $$,
  '42501',
  $msg$column 'organization_id' is not worker-writable$msg$,
  'a worker cannot move an instance to another tenant'
);

select throws_ok(
  $$ select public.worker_update_instance_runtime(
       '40000000-0000-4000-8000-000000000001', '{"state": "ready"}'::jsonb) $$,
  '42501',
  $msg$column 'state' is not worker-writable$msg$,
  'a worker cannot set instance state outside the operation lifecycle'
);

-- ---------------------------------------------------------------------------
-- Slice B: scoped listings
-- ---------------------------------------------------------------------------

select is(
  jsonb_array_length(public.worker_list_pending_ssh_key_syncs()),
  0,
  'nothing is pending an ssh key sync yet'
);

reset role;
update public.instances set ssh_keys_sync_pending = true
where id in ('40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002');
set local role guildcloud_site_worker;

select is(
  jsonb_array_length(public.worker_list_pending_ssh_key_syncs()),
  1,
  'the ssh key sync listing is scoped to this cluster only'
);

select is(
  public.worker_list_pending_ssh_key_syncs() -> 0 ->> 'id',
  '40000000-0000-4000-8000-000000000001',
  'the listed instance is this cluster own'
);

-- Keys arrive already joined, so the worker never reads the ssh_keys table.
select is(
  public.worker_list_pending_ssh_key_syncs() -> 0 -> 'public_keys' ->> 0,
  'ssh-ed25519 AAAA-alpha alpha@example',
  'the organization public keys are joined into the listing'
);

select is(
  jsonb_array_length(public.worker_list_warm_pool_vms(array['warm'])),
  1,
  'the warm pool listing is scoped to this cluster'
);

select is(
  public.worker_list_warm_pool_vms(array['warm']) -> 0 ->> 'id',
  '70000000-0000-4000-8000-00000000000a',
  'the listed warm vm belongs to this cluster'
);

select is(
  jsonb_array_length(public.worker_list_node_templates('ubuntu-2404', 'podB')),
  0,
  'a worker cannot resolve another cluster node template'
);

select is(
  public.worker_list_node_templates('ubuntu-2404', 'nodeA') -> 0 ->> 'proxmox_vmid',
  '9000',
  'a worker resolves its own cluster node template'
);

-- ---------------------------------------------------------------------------
-- Slice B: warm pool claim
-- ---------------------------------------------------------------------------

select isnt(
  public.worker_claim_warm_pool_vm(
    '40000000-0000-4000-8000-000000000001', 'ubuntu-2404', 'std-1'),
  null,
  'a worker claims a warm vm for its own instance'
);

-- A second claim must not hand the same pooled VM to another customer.
select is(
  public.worker_claim_warm_pool_vm(
    '40000000-0000-4000-8000-000000000001', 'ubuntu-2404', 'std-1'),
  null,
  'a claimed warm vm is never handed out twice'
);

select throws_ok(
  $$ select public.worker_claim_warm_pool_vm(
       '40000000-0000-4000-8000-000000000002', 'ubuntu-2404', 'std-1') $$,
  'P0002',
  'instance not found for this cluster',
  'a worker cannot claim a warm vm for another cluster instance'
);

select throws_ok(
  $$ select public.worker_update_warm_pool_vm(
       '70000000-0000-4000-8000-00000000000b', 'warm') $$,
  'P0002',
  'warm pool vm not found for this cluster',
  'a worker cannot update another cluster warm vm'
);

-- ---------------------------------------------------------------------------
-- Slice B: tailnet housekeeping is database-granted, not self-asserted
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.worker_get_tailnet_desired_state() $$,
  'the housekeeping worker reads the tailnet desired state'
);

select lives_ok(
  $$ select public.worker_mark_project_acl_applied('30000000-0000-4000-8000-000000000001') $$,
  'the housekeeping worker marks a project acl applied'
);

set local "request.jwt.claims" = '{"role":"guildcloud_site_worker","worker_id":"worker-guild-b"}';

select throws_ok(
  $$ select public.worker_get_tailnet_desired_state() $$,
  '42501',
  'worker does not hold the tailnet housekeeping role',
  'a non-housekeeping worker cannot read the tailnet desired state'
);

select throws_ok(
  $$ select public.worker_mark_project_acl_applied('30000000-0000-4000-8000-000000000001') $$,
  '42501',
  'worker does not hold the tailnet housekeeping role',
  'a non-housekeeping worker cannot mark a project acl applied'
);

select throws_ok(
  $$ select public.worker_mark_member_enrolled(
       '30000000-0000-4000-8000-000000000001', 'device-1') $$,
  '42501',
  'worker does not hold the tailnet housekeeping role',
  'a non-housekeeping worker cannot enroll a member device'
);

reset role;

-- The single-holder rule is enforced by the database, not by two env files
-- agreeing with each other.
select throws_ok(
  $$ update public.worker_identities set tailnet_housekeeping = true
     where worker_id = 'worker-guild-b' $$,
  '23505',
  NULL,
  'two live workers cannot both hold the tailnet housekeeping role'
);

-- ---------------------------------------------------------------------------
-- instances.updated_at (added 2026-08-29 after two misdiagnoses read state age
-- off created_at)
-- ---------------------------------------------------------------------------

reset role;

-- A dedicated row: the instances above have already been written to by earlier
-- assertions in this file, so they cannot speak to the untouched case.
insert into public.instances
  (id, organization_id, project_id, site_id, cluster_id, name,
   catalog_image_id, catalog_plan_id, state)
values
  ('40000000-0000-4000-8000-0000000000ff', '10000000-0000-4000-8000-000000000001',
   '30000000-0000-4000-8000-000000000001', 'lag-1', 'guild-a', 'updated-at-probe',
   'ubuntu-2404', 'std-1', 'ready');

-- No backfill, and INSERT does not stamp: an untouched row must report unknown
-- rather than a plausible-looking timestamp. That plausible timestamp is exactly
-- the bug this column replaces.
select is(
  (select updated_at from public.instances where id = '40000000-0000-4000-8000-0000000000ff'),
  null,
  'an untouched row reports null, not a fabricated time'
);

update public.instances set state = 'degraded'
where id = '40000000-0000-4000-8000-0000000000ff';

select isnt(
  (select updated_at from public.instances where id = '40000000-0000-4000-8000-0000000000ff'),
  null,
  'a real change stamps updated_at'
);

-- A no-op UPDATE must not make the row look freshly touched, or the column is
-- as misleading as created_at was.
create temporary table probe_stamp as
  select updated_at from public.instances where id = '40000000-0000-4000-8000-0000000000ff';

select lives_ok(
  $$ update public.instances set state = 'degraded'
     where id = '40000000-0000-4000-8000-0000000000ff' $$,
  'a no-op update is accepted'
);

select is(
  (select updated_at from public.instances where id = '40000000-0000-4000-8000-0000000000ff'),
  (select updated_at from probe_stamp),
  'a no-op update does not re-stamp updated_at'
);

-- ---------------------------------------------------------------------------
-- worker_list_cluster_operations: the listing that replaced a table read
--
-- Instance creation broke in production on 2026-08-29 because the worker listed
-- its operations with `.from("operations")`, which this role may not do. The
-- denial was swallowed and became "no work to do". The listing is an RPC now,
-- and it must be scoped the same way everything else here is: by the caller's
-- identity, never by anything the caller supplies.
-- ---------------------------------------------------------------------------

set local role guildcloud_site_worker;
set local "request.jwt.claims" = '{"role":"guildcloud_site_worker","worker_id":"worker-guild-a"}';

select is(
  jsonb_array_length(public.worker_list_cluster_operations()),
  1,
  'a worker sees the operations on its own cluster'
);

select is(
  (public.worker_list_cluster_operations() -> 0 ->> 'id')::uuid,
  '60000000-0000-4000-8000-00000000000a'::uuid,
  'and the one it sees is its own cluster''s operation'
);

select ok(
  not exists (
    select 1
    from jsonb_array_elements(public.worker_list_cluster_operations()) as row
    where (row ->> 'cluster_id') <> 'guild-a'
  ),
  'a Guild-A worker never sees a Guild-B operation'
);

-- The listing carries what the worker needs to execute the operation. Without
-- assigned_node and storage_id it would have to read the table again, which is
-- the thing being removed.
select ok(
  (public.worker_list_cluster_operations() -> 0) ?& array['id','kind','instance_id','assigned_node','storage_id','stages'],
  'the listing carries everything the worker needs to execute without a table read'
);

reset role;
set local role guildcloud_site_worker;
set local "request.jwt.claims" = '{"role":"guildcloud_site_worker","worker_id":"worker-revoked"}';

select throws_ok(
  $$select public.worker_list_cluster_operations()$$,
  '28000',
  null,
  'a revoked worker cannot list any operations'
);

reset role;
set local role guildcloud_site_worker;
set local "request.jwt.claims" = '{"role":"guildcloud_site_worker","worker_id":"worker-guild-b"}';

select throws_ok(
  $$select public.worker_list_cluster_operations(0)$$,
  '22023',
  null,
  'an out-of-range limit is rejected rather than silently clamped'
);

reset role;

select * from finish();
rollback;
