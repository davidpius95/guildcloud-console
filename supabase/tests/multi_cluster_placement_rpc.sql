begin;

create schema test_rpc;

create function test_rpc.reset_state()
returns void
language plpgsql
as $$
begin
  truncate table
    public.operation_stages,
    public.capacity_reservations,
    public.warm_pool_vms,
    public.operations,
    public.instances,
    public.catalog_image_cluster_templates,
    public.infrastructure_storage_targets,
    public.infrastructure_nodes,
    public.infrastructure_clusters,
    public.placement_settings
  restart identity cascade;

  insert into public.placement_settings (id, mode) values (true, 'single');
end
$$;

create function test_rpc.seed_capacity(
  p_mode text default 'single',
  p_now timestamptz default '2026-08-18 12:00:00+00',
  p_include_guild_b boolean default false
)
returns void
language plpgsql
as $$
begin
  update public.placement_settings set mode = p_mode where id;

  insert into public.infrastructure_clusters
    (id, site_id, name, enabled, admission_state, worker_heartbeat_at,
     capacity_observed_at, private_networking_healthy, backup_healthy,
     monitoring_healthy)
  values
    ('guild-a', 'lag-1', 'Guild-A', true, 'open', p_now, p_now, true, true, true);

  insert into public.infrastructure_nodes
    (cluster_id, node, enabled, admission_state, online, total_vcpu,
     committed_vcpu, total_memory_bytes, used_memory_bytes,
     committed_memory_bytes, observed_at)
  values
    ('guild-a', 'node-a', true, 'open', true, 10, 2,
     10737418240, 2147483648, 2147483648, p_now);

  insert into public.infrastructure_storage_targets
    (cluster_id, storage_id, node, enabled, healthy, shared, total_bytes,
     used_bytes, observed_at)
  values
    ('guild-a', 'shared-a', null, true, true, true,
     107374182400, 21474836480, p_now);

  insert into public.catalog_image_cluster_templates
    (catalog_image_id, cluster_id, source_node, proxmox_vmid, storage_id,
     target_nodes, enabled, tested_at, template_version)
  values
    ('ubuntu-2404', 'guild-a', 'node-a', 9000, 'shared-a',
     array['node-a'], true, p_now, 'test-a');

  if p_include_guild_b then
    insert into public.infrastructure_clusters
      (id, site_id, name, enabled, admission_state, worker_heartbeat_at,
       capacity_observed_at, private_networking_healthy, backup_healthy,
       monitoring_healthy)
    values
      ('guild-b', 'lag-1', 'Guild-B', true, 'open', p_now, p_now, true, true, true);

    insert into public.infrastructure_nodes
      (cluster_id, node, enabled, admission_state, online, total_vcpu,
       committed_vcpu, total_memory_bytes, used_memory_bytes,
       committed_memory_bytes, observed_at)
    values
      ('guild-b', 'node-b', true, 'open', true, 10, 2,
       10737418240, 2147483648, 2147483648, p_now);

    insert into public.infrastructure_storage_targets
      (cluster_id, storage_id, node, enabled, healthy, shared, total_bytes,
       used_bytes, observed_at)
    values
      ('guild-b', 'shared-b', null, true, true, true,
       107374182400, 21474836480, p_now);

    insert into public.catalog_image_cluster_templates
      (catalog_image_id, cluster_id, source_node, proxmox_vmid, storage_id,
       target_nodes, enabled, tested_at, template_version)
    values
      ('ubuntu-2404', 'guild-b', 'node-b', 9001, 'shared-b',
       array['node-b'], true, p_now, 'test-b');
  end if;
end
$$;

create function test_rpc.create_request(
  p_operation_id uuid,
  p_instance_id uuid,
  p_started_at timestamptz,
  p_site_id text default 'lag-1',
  p_image_id text default 'ubuntu-2404',
  p_plan_id text default 'std-1'
)
returns void
language plpgsql
as $$
begin
  insert into public.instances
    (id, site_id, catalog_image_id, catalog_plan_id)
  values (p_instance_id, p_site_id, p_image_id, p_plan_id);

  insert into public.operations
    (id, site_id, instance_id, kind, state, started_at)
  values
    (p_operation_id, p_site_id, p_instance_id, 'instance.create', 'pending',
     p_started_at);

  insert into public.operation_stages (operation_id, stage)
  values
    (p_operation_id, 'preflight'),
    (p_operation_id, 'capacity_reservation'),
    (p_operation_id, 'operation_created');
end
$$;

create function test_rpc.rejection_after(
  p_mutation text,
  p_plan_id text default 'std-1',
  p_now timestamptz default '2026-08-18 12:00:00+00'
)
returns text[]
language plpgsql
as $$
declare
  v_reasons text[];
begin
  perform test_rpc.reset_state();
  perform test_rpc.seed_capacity('single', p_now, false);
  perform test_rpc.create_request(
    '40000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001',
    p_now,
    'lag-1',
    'ubuntu-2404',
    p_plan_id
  );
  execute p_mutation;
  perform public.place_next_pending_operation('guild-a', p_now, null);

  select array(
    select jsonb_array_elements_text(candidate->'rejection_reasons')
    from (
      select candidate
      from jsonb_array_elements(placement_decision->'candidates') candidate
      where candidate->>'cluster_id' = 'guild-a'
        and candidate->>'node' = 'node-a'
      order by candidate->>'storage_id'
      limit 1
    ) selected_candidate
  )
  into v_reasons
  from public.operations
  where id = '40000000-0000-0000-0000-000000000001';

  return v_reasons;
end
$$;

select no_plan();

select has_function(
  'public', 'place_next_pending_operation',
  array['text', 'timestamp with time zone', 'text'],
  'atomic placement RPC exists with the binding signature'
);
select function_returns(
  'public', 'place_next_pending_operation',
  array['text', 'timestamp with time zone', 'text'], 'uuid',
  'atomic placement RPC returns one operation UUID'
);
select is_definer(
  'public', 'place_next_pending_operation',
  array['text', 'timestamp with time zone', 'text'],
  'atomic placement RPC is security definer'
);
select function_privs_are(
  'public', 'place_next_pending_operation',
  array['text', 'timestamp with time zone', 'text'], 'public', array[]::text[],
  'PUBLIC cannot execute placement'
);
select function_privs_are(
  'public', 'place_next_pending_operation',
  array['text', 'timestamp with time zone', 'text'], 'anon', array[]::text[],
  'anon cannot execute placement'
);
select function_privs_are(
  'public', 'place_next_pending_operation',
  array['text', 'timestamp with time zone', 'text'], 'authenticated', array[]::text[],
  'authenticated cannot execute placement'
);
select function_privs_are(
  'public', 'place_next_pending_operation',
  array['text', 'timestamp with time zone', 'text'], 'service_role', array['EXECUTE'],
  'service role alone receives placement execution'
);

select test_rpc.reset_state();
select test_rpc.seed_capacity();
select throws_ok(
  $$ select public.place_next_pending_operation('missing', '2026-08-18 12:00:00+00', null) $$,
  '22023', 'Unknown worker cluster: missing.',
  'an unregistered worker identity is rejected'
);
select throws_ok(
  $$ select public.place_next_pending_operation('guild-a', '2026-08-18 12:00:00+00', 'missing') $$,
  '22023', 'Unknown forced cluster: missing.',
  'an unregistered forced cluster is rejected'
);
select throws_ok(
  $$ select public.place_next_pending_operation('guild-a', null, null) $$,
  '22023', 'Placement time is required.',
  'a null placement clock is rejected'
);

select test_rpc.reset_state();
select test_rpc.seed_capacity('multi', '2026-08-18 12:00:00+00', true);
select test_rpc.create_request(
  '40000000-0000-0000-0000-000000000002',
  '50000000-0000-0000-0000-000000000002',
  '2026-08-18 11:59:00+00'
);
select test_rpc.create_request(
  '40000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  '2026-08-18 11:58:00+00'
);
select is(
  public.place_next_pending_operation(
    'guild-b', '2026-08-18 12:00:00+00', null
  )::text,
  '40000000-0000-0000-0000-000000000001',
  'the oldest pending create operation is placed first'
);
select is(
  (select cluster_id from public.operations
   where id = '40000000-0000-0000-0000-000000000001'),
  'guild-a',
  'the score tie resolves to the ascending cluster identity'
);
select is(
  (select assigned_node from public.operations
   where id = '40000000-0000-0000-0000-000000000001'),
  'node-a',
  'the operation records the selected node'
);
select is(
  (select storage_id from public.operations
   where id = '40000000-0000-0000-0000-000000000001'),
  'shared-a',
  'the operation records the selected storage domain'
);
select is(
  (select cluster_id || ':' || proxmox_node from public.instances
   where id = '50000000-0000-0000-0000-000000000001'),
  'guild-a:node-a',
  'the instance receives the same cluster and node atomically'
);
select is(
  (select count(*)::integer from public.capacity_reservations
   where operation_id = '40000000-0000-0000-0000-000000000001'),
  1,
  'placement creates exactly one reservation'
);
select results_eq(
  $$ select cluster_id, node, storage_id, vcpu, memory_gb, disk_gb, state
     from public.capacity_reservations
     where operation_id = '40000000-0000-0000-0000-000000000001' $$,
  $$ values ('guild-a'::text, 'node-a'::text, 'shared-a'::text,
             1, 1::numeric, 10::numeric, 'held'::text) $$,
  'the reservation contains the selected identity and exact plan resources'
);
select is(
  (select count(*)::integer from public.operation_stages
   where operation_id = '40000000-0000-0000-0000-000000000001'
     and stage in ('preflight', 'capacity_reservation')
     and status = 'done' and started_at is not null and finished_at is not null),
  2,
  'the two scheduler-owned stages complete on placement'
);
select is(
  (select status from public.operation_stages
   where operation_id = '40000000-0000-0000-0000-000000000001'
     and stage = 'operation_created'),
  'pending',
  'placement does not advance the worker-owned operation_created stage'
);
select is(
  (select (detail->>'cluster_id') || ':' || (detail->>'node') || ':' ||
          (detail->>'storage_id')
   from public.operation_stages
   where operation_id = '40000000-0000-0000-0000-000000000001'
     and stage = 'capacity_reservation'),
  'guild-a:node-a:shared-a',
  'completed scheduler stages record the selected placement identity'
);
select is(
  (select cluster_id from public.operations
   where id = '40000000-0000-0000-0000-000000000002'),
  null,
  'the younger operation remains unassigned'
);
select is(
  (select placement_decision->>'mode' from public.operations
   where id = '40000000-0000-0000-0000-000000000001'),
  'multi',
  'the decision records placement mode'
);
select is(
  (select placement_decision->>'requesting_worker_cluster_id'
   from public.operations
   where id = '40000000-0000-0000-0000-000000000001'),
  'guild-b',
  'the caller identity is evidence and does not constrain the winner'
);
select ok(
  (select placement_decision ?& array['forced', 'request', 'candidates', 'selected_candidate']
   from public.operations
   where id = '40000000-0000-0000-0000-000000000001'),
  'the decision has the required request, candidate, and selected evidence'
);
select ok(
  (select abs(
      (placement_decision->'selected_candidate'->>'score')::numeric -
      (0.5 * 0.7 + 0.25 * (4::numeric / 7) + 0.2 * 0.7)
    ) < 0.000000000001
   from public.operations
   where id = '40000000-0000-0000-0000-000000000001'),
  'SQL scoring matches the Task 1 policy weights and headroom ratios'
);
select ok(
  (select placement_decision::text not like '%management_address%'
   from public.operations
   where id = '40000000-0000-0000-0000-000000000001'),
  'the decision does not contain management addresses'
);

select test_rpc.reset_state();
select test_rpc.seed_capacity();
select test_rpc.create_request(
  '40000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  '2026-08-18 11:59:00+00'
);
update public.operations
set kind = 'instance.resize'
where id = '40000000-0000-0000-0000-000000000001';
select test_rpc.create_request(
  '40000000-0000-0000-0000-000000000002',
  '50000000-0000-0000-0000-000000000002',
  '2026-08-18 12:00:00+00'
);
select is(
  public.place_next_pending_operation('guild-a', '2026-08-18 12:00:00+00', null)::text,
  '40000000-0000-0000-0000-000000000002',
  'placement skips pending operations that are not instance.create'
);

select test_rpc.reset_state();
select test_rpc.seed_capacity();
select test_rpc.create_request(
  '40000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  '2026-08-18 12:00:00+00', 'other-site'
);
select is(
  public.place_next_pending_operation('guild-a', '2026-08-18 12:00:00+00', null),
  null,
  'clusters outside the customer site are not eligible'
);
select is(
  (select jsonb_array_length(placement_decision->'candidates')
   from public.operations where id = '40000000-0000-0000-0000-000000000001'),
  0,
  'site filtering excludes unrelated candidates from the decision'
);
select is(
  (select failure_reason from public.operations
   where id = '40000000-0000-0000-0000-000000000001'),
  'Waiting for eligible capacity or capability.',
  'no candidate stores the customer-safe wait reason'
);
select is(
  (select count(*)::integer from public.capacity_reservations), 0,
  'no candidate creates no reservation'
);
select is(
  (select count(*)::integer from public.operation_stages where status = 'pending'),
  3,
  'no candidate leaves every stage pending'
);

select test_rpc.reset_state();
select test_rpc.seed_capacity();
select test_rpc.create_request(
  '40000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  '2026-08-18 12:00:00+00', 'lag-1', 'debian-12'
);
select is(
  public.place_next_pending_operation('guild-a', '2026-08-18 12:00:00+00', null),
  null,
  'a cluster without the requested image capability is rejected'
);
select is(
  (select placement_decision->'candidates'->0->'rejection_reasons'->>0
   from public.operations where id = '40000000-0000-0000-0000-000000000001'),
  'template_unavailable',
  'missing image capability records the policy rejection code'
);

select is(
  test_rpc.rejection_after(
    $$ update public.catalog_image_cluster_templates set target_nodes = array['node-z'] $$
  ),
  array['template_target_mismatch'],
  'a template not tested for the candidate node is rejected'
);
select is(
  test_rpc.rejection_after(
    $$ update public.infrastructure_clusters set enabled = false $$
  ),
  array['cluster_disabled'],
  'a disabled cluster is rejected'
);
select is(
  test_rpc.rejection_after(
    $$ update public.infrastructure_clusters set admission_state = 'paused' $$
  ),
  array['cluster_admission_closed'],
  'a paused cluster is rejected'
);
select is(
  test_rpc.rejection_after(
    $$ update public.infrastructure_clusters set worker_heartbeat_at = '2026-08-18 11:58:59.999+00' $$
  ),
  array['worker_heartbeat_stale'],
  'a worker heartbeat older than 60 seconds is rejected'
);
select is(
  test_rpc.rejection_after(
    $$ update public.infrastructure_clusters set worker_heartbeat_at = '2026-08-18 12:00:00.001+00' $$
  ),
  array['worker_heartbeat_stale'],
  'a future worker heartbeat is rejected'
);
select is(
  test_rpc.rejection_after(
    $$ update public.infrastructure_clusters
         set worker_heartbeat_at = '2026-08-18 12:00:00.001+00',
             capacity_observed_at = '2026-08-18 12:00:00.001+00';
       update public.infrastructure_nodes
         set observed_at = '2026-08-18 12:00:00.001+00';
       update public.infrastructure_storage_targets
         set observed_at = '2026-08-18 12:00:00.001+00' $$
  ),
  array[
    'worker_heartbeat_stale',
    'cluster_capacity_stale',
    'node_observation_stale',
    'storage_observation_stale'
  ],
  'future cluster, node, and storage observations are all rejected'
);
select is(
  test_rpc.rejection_after(
    $$ update public.infrastructure_clusters set capacity_observed_at = '2026-08-18 11:58:59.999+00' $$
  ),
  array['cluster_capacity_stale'],
  'stale cluster capacity is rejected'
);
select is(
  test_rpc.rejection_after(
    $$ update public.infrastructure_nodes set enabled = false $$
  ),
  array['node_disabled'],
  'a disabled node is rejected'
);
select is(
  test_rpc.rejection_after(
    $$ update public.infrastructure_nodes set admission_state = 'draining' $$
  ),
  array['node_admission_closed'],
  'a draining node is rejected'
);
select is(
  test_rpc.rejection_after(
    $$ update public.infrastructure_nodes set online = false $$
  ),
  array['node_offline'],
  'an offline node is rejected'
);
select is(
  test_rpc.rejection_after(
    $$ update public.infrastructure_nodes set observed_at = '2026-08-18 11:58:59.999+00' $$
  ),
  array['node_observation_stale'],
  'a stale node observation is rejected'
);
select is(
  test_rpc.rejection_after(
    $$ update public.catalog_image_cluster_templates set enabled = false $$
  ),
  array['template_unavailable'],
  'a disabled template capability is rejected'
);
select is(
  test_rpc.rejection_after(
    $$ update public.infrastructure_storage_targets set enabled = false $$
  ),
  array['storage_disabled'],
  'disabled storage is rejected'
);
select is(
  test_rpc.rejection_after(
    $$ update public.infrastructure_storage_targets set healthy = false $$
  ),
  array['storage_unhealthy'],
  'unhealthy storage is rejected'
);
select is(
  test_rpc.rejection_after(
    $$ update public.infrastructure_storage_targets set observed_at = '2026-08-18 11:58:59.999+00' $$
  ),
  array['storage_observation_stale'],
  'stale storage is rejected'
);
select is(
  test_rpc.rejection_after(
    $$ update public.infrastructure_clusters set private_networking_healthy = false $$
  ),
  array['private_networking_unhealthy'],
  'failed private networking is rejected'
);
select is(
  test_rpc.rejection_after(
    $$ update public.infrastructure_clusters set backup_healthy = false $$
  ),
  array['backup_unhealthy'],
  'failed backup admission is rejected'
);
select is(
  test_rpc.rejection_after(
    $$ update public.infrastructure_clusters set monitoring_healthy = false $$
  ),
  array['monitoring_unhealthy'],
  'failed monitoring admission is rejected'
);

select is(
  test_rpc.rejection_after(
    $$ update public.infrastructure_nodes
       set used_memory_bytes = 2147483648, committed_memory_bytes = 2147483648 $$,
    'std-5'
  ),
  array[]::text[],
  'exactly 30 percent post-placement RAM reserve is eligible'
);
select is(
  test_rpc.rejection_after(
    $$ update public.infrastructure_nodes
       set used_memory_bytes = 2147483648, committed_memory_bytes = 2147483648 $$,
    'std-6'
  ),
  array['memory_reserve_exceeded', 'vcpu_limit_exceeded', 'storage_reserve_exceeded'],
  'one byte beyond RAM and disk reserve plus one vCPU beyond ceiling is rejected'
);

select test_rpc.reset_state();
select test_rpc.seed_capacity();
update public.infrastructure_clusters
set worker_heartbeat_at = '2026-08-18 11:59:00+00',
    capacity_observed_at = '2026-08-18 11:59:00+00';
update public.infrastructure_nodes set observed_at = '2026-08-18 11:59:00+00';
update public.infrastructure_storage_targets set observed_at = '2026-08-18 11:59:00+00';
select test_rpc.create_request(
  '40000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  '2026-08-18 12:00:00+00'
);
select is(
  public.place_next_pending_operation('guild-a', '2026-08-18 12:00:00+00', null)::text,
  '40000000-0000-0000-0000-000000000001',
  'observations exactly 60 seconds old remain eligible'
);

select test_rpc.reset_state();
select test_rpc.seed_capacity();
select test_rpc.create_request(
  '41000000-0000-0000-0000-000000000001',
  '51000000-0000-0000-0000-000000000001',
  '2026-08-18 11:00:00+00'
);
update public.operations set cluster_id = 'guild-a', assigned_node = 'node-a', storage_id = 'shared-a'
where id = '41000000-0000-0000-0000-000000000001';
insert into public.capacity_reservations
  (operation_id, site_id, cluster_id, node, storage_id, vcpu, memory_gb,
   disk_gb, state, expires_at)
values
  ('41000000-0000-0000-0000-000000000001', 'lag-1', 'guild-a', 'node-a',
   'shared-a', 5, 5, 50, 'held', '2026-08-18 12:15:00+00');
select test_rpc.create_request(
  '40000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  '2026-08-18 12:00:00+00'
);
select is(
  public.place_next_pending_operation('guild-a', '2026-08-18 12:00:00+00', null),
  null,
  'an active held reservation consumes node and shared-storage capacity'
);
select ok(
  (select placement_decision->'candidates'->0->'rejection_reasons'
          ?& array[
            'memory_reserve_exceeded',
            'vcpu_limit_exceeded',
            'storage_reserve_exceeded'
          ]
   from public.operations where id = '40000000-0000-0000-0000-000000000001'),
  'active reservation rejection records every exhausted resource'
);
update public.capacity_reservations
set state = 'committed', expires_at = '2026-08-18 11:00:00+00';
select is(
  public.place_next_pending_operation('guild-a', '2026-08-18 12:00:00+00', null),
  null,
  'a committed reservation remains active after its hold expiry'
);
update public.capacity_reservations set expires_at = '2026-08-18 11:59:59+00';
update public.capacity_reservations set state = 'held';
select is(
  public.place_next_pending_operation('guild-a', '2026-08-18 12:00:00+00', null)::text,
  '40000000-0000-0000-0000-000000000001',
  'an expired held reservation is ignored'
);

select test_rpc.reset_state();
select test_rpc.seed_capacity();
insert into public.infrastructure_nodes
  (cluster_id, node, enabled, admission_state, online, total_vcpu,
   committed_vcpu, total_memory_bytes, used_memory_bytes,
   committed_memory_bytes, observed_at)
values
  ('guild-a', 'node-z', true, 'open', true, 10, 2,
   10737418240, 2147483648, 2147483648, '2026-08-18 12:00:00+00');
update public.infrastructure_storage_targets
set shared = false, node = 'node-a', storage_id = 'local-a';
update public.catalog_image_cluster_templates
set storage_id = 'local-a';
select test_rpc.create_request(
  '41000000-0000-0000-0000-000000000001',
  '51000000-0000-0000-0000-000000000001',
  '2026-08-18 11:00:00+00'
);
update public.operations set cluster_id = 'guild-a', assigned_node = 'node-z', storage_id = 'local-a'
where id = '41000000-0000-0000-0000-000000000001';
insert into public.capacity_reservations
  (operation_id, site_id, cluster_id, node, storage_id, vcpu, memory_gb,
   disk_gb, state, expires_at)
values
  ('41000000-0000-0000-0000-000000000001', 'lag-1', 'guild-a', 'node-z',
   'local-a', 0, 0, 80, 'committed', '2026-08-18 11:00:00+00');
select test_rpc.create_request(
  '40000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  '2026-08-18 12:00:00+00'
);
select is(
  public.place_next_pending_operation('guild-a', '2026-08-18 12:00:00+00', null)::text,
  '40000000-0000-0000-0000-000000000001',
  'a local-storage reservation on another node does not consume this node storage'
);

select test_rpc.reset_state();
select test_rpc.seed_capacity('multi', '2026-08-18 12:00:00+00', true);
update public.infrastructure_nodes
set used_memory_bytes = 1073741824, committed_memory_bytes = 1073741824
where cluster_id = 'guild-b';
select test_rpc.create_request(
  '40000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  '2026-08-18 12:00:00+00'
);
select is(
  public.place_next_pending_operation('guild-a', '2026-08-18 12:00:00+00', null)::text,
  '40000000-0000-0000-0000-000000000001',
  'multi mode places an eligible request'
);
select is(
  (select cluster_id from public.operations where id = '40000000-0000-0000-0000-000000000001'),
  'guild-b',
  'multi mode chooses the highest weighted score'
);

select test_rpc.reset_state();
select test_rpc.seed_capacity('multi', '2026-08-18 12:00:00+00', true);
insert into public.warm_pool_vms
  (site_id, catalog_image_id, catalog_plan_id, proxmox_vmid, proxmox_node,
   state, cluster_id)
values ('lag-1', 'ubuntu-2404', 'std-1', 9200, 'node-b', 'warm', 'guild-b');
select test_rpc.create_request(
  '40000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  '2026-08-18 12:00:00+00'
);
select public.place_next_pending_operation('guild-a', '2026-08-18 12:00:00+00', null);
select is(
  (select cluster_id from public.operations where id = '40000000-0000-0000-0000-000000000001'),
  'guild-b',
  'the exact warm image and plan adds the five-percent score bonus'
);
select ok(
  (select abs(
      max((candidate->>'score')::numeric) -
      min((candidate->>'score')::numeric) - 0.05
    ) < 0.000000000001
   from public.operations operation,
        jsonb_array_elements(operation.placement_decision->'candidates') candidate
   where operation.id = '40000000-0000-0000-0000-000000000001'),
  'the warm-pool score bonus is exactly five percent'
);

select test_rpc.reset_state();
select test_rpc.seed_capacity('single', '2026-08-18 12:00:00+00', true);
update public.infrastructure_nodes set used_memory_bytes = 0, committed_memory_bytes = 0
where cluster_id = 'guild-b';
select test_rpc.create_request(
  '40000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  '2026-08-18 12:00:00+00'
);
select public.place_next_pending_operation('guild-b', '2026-08-18 12:00:00+00', null);
select is(
  (select cluster_id from public.operations where id = '40000000-0000-0000-0000-000000000001'),
  'guild-a',
  'single mode assigns Guild-A even when Guild-B scores higher'
);

select test_rpc.reset_state();
select test_rpc.seed_capacity('shadow', '2026-08-18 12:00:00+00', true);
update public.infrastructure_nodes set used_memory_bytes = 0, committed_memory_bytes = 0
where cluster_id = 'guild-b';
select test_rpc.create_request(
  '40000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  '2026-08-18 12:00:00+00'
);
select public.place_next_pending_operation('guild-a', '2026-08-18 12:00:00+00', null);
select is(
  (select cluster_id from public.operations where id = '40000000-0000-0000-0000-000000000001'),
  'guild-a',
  'shadow mode keeps the real assignment on Guild-A'
);
select is(
  (select placement_decision->'shadow_selected_candidate'->>'cluster_id'
   from public.operations where id = '40000000-0000-0000-0000-000000000001'),
  'guild-b',
  'shadow mode records the unrestricted multi-cluster winner'
);

select test_rpc.reset_state();
select test_rpc.seed_capacity('single', '2026-08-18 12:00:00+00', true);
select test_rpc.create_request(
  '40000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  '2026-08-18 12:00:00+00'
);
select public.place_next_pending_operation('guild-a', '2026-08-18 12:00:00+00', 'guild-b');
select is(
  (select cluster_id from public.operations where id = '40000000-0000-0000-0000-000000000001'),
  'guild-b',
  'the forced-cluster hook overrides single-mode real scope'
);
select is(
  (select placement_decision->>'forced' from public.operations
   where id = '40000000-0000-0000-0000-000000000001'),
  'true',
  'a forced decision is explicitly recorded'
);

select * from finish(true);
rollback;
