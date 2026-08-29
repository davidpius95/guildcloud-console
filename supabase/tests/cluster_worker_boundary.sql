-- Contract for the cluster-scoped worker RPC boundary (plan Task 7).
--
-- The property under test: a worker token proves *which* worker is calling, and
-- the database decides which cluster that worker may touch. A Guild-A worker
-- must not be able to read, advance, or finalize a Guild-B operation even though
-- it is calling the same functions with the same privileges.

begin;
select plan(29);

insert into public.worker_identities (worker_id, cluster_id, description) values
  ('worker-guild-a', 'guild-a', 'Guild-A site worker'),
  ('worker-guild-b', 'guild-b', 'Guild-B site worker'),
  ('worker-revoked', 'guild-a', 'decommissioned Guild-A worker');

update public.worker_identities set revoked_at = now() where worker_id = 'worker-revoked';

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
  $$ select public.worker_complete_stage('60000000-0000-4000-8000-00000000000b', 'proxmox_api_call', 'succeeded') $$,
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
  'stage status must be succeeded, failed, or skipped',
  'an unknown stage status is rejected'
);

reset role;

select is(
  (select status from public.operation_stages
   where operation_id = '60000000-0000-4000-8000-00000000000b' and stage = 'proxmox_api_call'),
  'running',
  'starting a stage records running status'
);

select is(
  (select state from public.operations where id = '60000000-0000-4000-8000-00000000000b'),
  'running',
  'starting a stage moves its operation to running'
);

select * from finish();
rollback;
