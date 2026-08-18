begin;

select no_plan();

select has_table('public', 'infrastructure_clusters', 'clusters table exists');
select has_table('public', 'infrastructure_nodes', 'nodes table exists');
select has_table(
  'public', 'infrastructure_storage_targets', 'storage targets table exists'
);
select has_table(
  'public', 'catalog_image_cluster_templates', 'cluster templates table exists'
);
select has_table('public', 'placement_settings', 'placement settings table exists');

select columns_are(
  'public', 'infrastructure_clusters',
  array[
    'id', 'site_id', 'name', 'enabled', 'admission_state', 'worker_id',
    'worker_heartbeat_at', 'capacity_observed_at',
    'private_networking_healthy', 'backup_healthy', 'monitoring_healthy',
    'failure_reason', 'created_at', 'updated_at'
  ]
);
select columns_are(
  'public', 'infrastructure_nodes',
  array[
    'cluster_id', 'node', 'enabled', 'admission_state', 'online',
    'total_vcpu', 'committed_vcpu', 'total_memory_bytes',
    'used_memory_bytes', 'committed_memory_bytes', 'cpu_utilization',
    'observed_at', 'failure_reason'
  ]
);
select columns_are(
  'public', 'infrastructure_storage_targets',
  array[
    'id', 'cluster_id', 'storage_id', 'node', 'enabled', 'healthy',
    'shared', 'total_bytes', 'used_bytes', 'observed_at', 'failure_reason'
  ]
);
select columns_are(
  'public', 'catalog_image_cluster_templates',
  array[
    'catalog_image_id', 'cluster_id', 'source_node', 'proxmox_vmid',
    'storage_id', 'target_nodes', 'clone_mode', 'enabled', 'tested_at',
    'template_version', 'created_at', 'updated_at'
  ]
);
select columns_are(
  'public', 'placement_settings', array['id', 'mode', 'updated_at']
);

select col_is_pk(
  'public', 'infrastructure_clusters', 'id', 'clusters use id as primary key'
);
select col_is_pk(
  'public', 'infrastructure_nodes', array['cluster_id', 'node'],
  'nodes use cluster and node as primary key'
);
select col_is_pk(
  'public', 'infrastructure_storage_targets', 'id',
  'storage targets use id as primary key'
);
select col_is_pk(
  'public', 'catalog_image_cluster_templates',
  array['catalog_image_id', 'cluster_id'],
  'template capabilities use image and cluster as primary key'
);
select col_is_pk(
  'public', 'placement_settings', 'id', 'placement settings uses singleton id'
);

select col_type_is(
  'public', 'infrastructure_clusters', 'id', 'text', 'cluster id is text'
);
select col_type_is(
  'public', 'infrastructure_clusters', 'worker_heartbeat_at',
  'timestamp with time zone', 'worker heartbeat is timezone-aware'
);
select col_type_is(
  'public', 'infrastructure_nodes', 'total_vcpu', 'integer',
  'node vCPU capacity is integer'
);
select col_type_is(
  'public', 'infrastructure_nodes', 'total_memory_bytes', 'bigint',
  'node memory capacity is bigint'
);
select col_type_is(
  'public', 'infrastructure_nodes', 'cpu_utilization', 'numeric',
  'node CPU utilization is numeric'
);
select col_type_is(
  'public', 'infrastructure_storage_targets', 'id', 'uuid',
  'storage target id is UUID'
);
select col_type_is(
  'public', 'infrastructure_storage_targets', 'total_bytes', 'bigint',
  'storage capacity is bigint'
);
select col_type_is(
  'public', 'catalog_image_cluster_templates', 'target_nodes', 'text[]',
  'tested target nodes are a text array'
);
select col_type_is(
  'public', 'catalog_image_cluster_templates', 'proxmox_vmid', 'integer',
  'template VMID is integer'
);
select col_type_is(
  'public', 'placement_settings', 'id', 'boolean',
  'placement singleton id is boolean'
);
select col_type_is(
  'public', 'operations', 'cluster_id', 'text',
  'operation cluster id is text'
);
select col_type_is(
  'public', 'operations', 'assigned_node', 'text',
  'operation assigned node is text'
);
select col_type_is(
  'public', 'operations', 'storage_id', 'text',
  'operation storage id is text'
);
select col_type_is(
  'public', 'operations', 'placement_decision', 'jsonb',
  'operation placement decision is JSONB'
);
select col_type_is(
  'public', 'instances', 'cluster_id', 'text',
  'instance cluster id is text'
);
select col_type_is(
  'public', 'capacity_reservations', 'cluster_id', 'text',
  'reservation cluster id is text'
);
select col_type_is(
  'public', 'capacity_reservations', 'storage_id', 'text',
  'reservation storage id is text'
);
select col_type_is(
  'public', 'warm_pool_vms', 'cluster_id', 'text',
  'warm VM cluster id is text'
);

select col_default_is(
  'public', 'infrastructure_clusters', 'enabled', 'false',
  'cluster scheduling is disabled by default'
);
select col_default_is(
  'public', 'infrastructure_clusters', 'admission_state', 'paused',
  'cluster admission is paused by default'
);
select col_default_is(
  'public', 'infrastructure_clusters', 'private_networking_healthy', 'false',
  'cluster networking health is false by default'
);
select col_default_is(
  'public', 'infrastructure_clusters', 'backup_healthy', 'false',
  'cluster backup health is false by default'
);
select col_default_is(
  'public', 'infrastructure_clusters', 'monitoring_healthy', 'false',
  'cluster monitoring health is false by default'
);
select col_default_is(
  'public', 'infrastructure_nodes', 'enabled', 'false',
  'node scheduling is disabled by default'
);
select col_default_is(
  'public', 'infrastructure_nodes', 'admission_state', 'paused',
  'node admission is paused by default'
);
select col_default_is(
  'public', 'infrastructure_nodes', 'online', 'false',
  'node online state is false by default'
);
select col_default_is(
  'public', 'infrastructure_nodes', 'total_vcpu', '0',
  'node vCPU capacity defaults to zero'
);
select col_default_is(
  'public', 'infrastructure_nodes', 'committed_vcpu', '0',
  'node committed vCPU defaults to zero'
);
select col_default_is(
  'public', 'infrastructure_nodes', 'total_memory_bytes', '0',
  'node memory capacity defaults to zero'
);
select col_default_is(
  'public', 'infrastructure_nodes', 'used_memory_bytes', '0',
  'node used memory defaults to zero'
);
select col_default_is(
  'public', 'infrastructure_nodes', 'committed_memory_bytes', '0',
  'node committed memory defaults to zero'
);
select col_default_is(
  'public', 'infrastructure_nodes', 'cpu_utilization', '0',
  'node CPU utilization defaults to zero'
);
select col_default_is(
  'public', 'infrastructure_storage_targets', 'enabled', 'false',
  'storage scheduling is disabled by default'
);
select col_default_is(
  'public', 'infrastructure_storage_targets', 'healthy', 'false',
  'storage health is false by default'
);
select col_default_is(
  'public', 'infrastructure_storage_targets', 'shared', 'false',
  'storage defaults to local topology'
);
select col_default_is(
  'public', 'infrastructure_storage_targets', 'total_bytes', '0',
  'storage total bytes defaults to zero'
);
select col_default_is(
  'public', 'infrastructure_storage_targets', 'used_bytes', '0',
  'storage used bytes defaults to zero'
);
select col_default_is(
  'public', 'catalog_image_cluster_templates', 'target_nodes', array[]::text[],
  'template target nodes default to an empty array'
);
select col_default_is(
  'public', 'catalog_image_cluster_templates', 'clone_mode', 'full',
  'template clone mode defaults to full'
);
select col_default_is(
  'public', 'catalog_image_cluster_templates', 'enabled', 'false',
  'template capabilities are disabled by default'
);
select col_default_is(
  'public', 'placement_settings', 'id', 'true',
  'placement settings default to the singleton identity'
);
select col_default_is(
  'public', 'placement_settings', 'mode', 'single',
  'placement mode defaults to single-cluster compatibility'
);
select col_default_is(
  'public', 'capacity_reservations', 'cluster_id', 'guild-a',
  'legacy reservations default to Guild-A'
);
select col_default_is(
  'public', 'capacity_reservations', 'storage_id', 'ceph-vm',
  'legacy reservations default to Guild-A Ceph storage'
);

select col_is_null(
  'public', 'operations', 'cluster_id', 'operation cluster remains nullable'
);
select col_is_null(
  'public', 'operations', 'assigned_node', 'operation node remains nullable'
);
select col_is_null(
  'public', 'operations', 'storage_id', 'operation storage remains nullable'
);
select col_is_null(
  'public', 'operations', 'placement_decision',
  'operation decision remains nullable'
);
select col_is_null(
  'public', 'instances', 'cluster_id', 'instance cluster remains nullable'
);
select col_not_null(
  'public', 'capacity_reservations', 'cluster_id',
  'reservation cluster is required after backfill'
);
select col_not_null(
  'public', 'capacity_reservations', 'storage_id',
  'reservation storage is required after backfill'
);
select col_not_null(
  'public', 'warm_pool_vms', 'cluster_id',
  'warm VM cluster is required after backfill'
);

select fk_ok(
  'public', 'infrastructure_nodes', 'cluster_id',
  'public', 'infrastructure_clusters', 'id'
);
select fk_ok(
  'public', 'infrastructure_storage_targets', 'cluster_id',
  'public', 'infrastructure_clusters', 'id'
);
select fk_ok(
  'public', 'catalog_image_cluster_templates', 'catalog_image_id',
  'public', 'catalog_images', 'id'
);
select fk_ok(
  'public', 'catalog_image_cluster_templates', 'cluster_id',
  'public', 'infrastructure_clusters', 'id'
);
select fk_ok(
  'public', 'operations', 'cluster_id',
  'public', 'infrastructure_clusters', 'id'
);
select fk_ok(
  'public', 'instances', 'cluster_id',
  'public', 'infrastructure_clusters', 'id'
);
select fk_ok(
  'public', 'capacity_reservations', 'cluster_id',
  'public', 'infrastructure_clusters', 'id'
);
select fk_ok(
  'public', 'warm_pool_vms', 'cluster_id',
  'public', 'infrastructure_clusters', 'id'
);
select is(
  (select count(*) from public.infrastructure_clusters),
  1::bigint,
  'Guild-A is the only initial infrastructure cluster'
);
select results_eq(
  $$
    select id, site_id, name, enabled, admission_state
    from public.infrastructure_clusters
  $$,
  $$ values ('guild-a'::text, 'lag-1'::text, 'Guild-A'::text, true, 'paused'::text) $$,
  'Guild-A seed has the approved compatibility values'
);
select is(
  (select count(*) from public.infrastructure_clusters where id = 'guild-b'),
  0::bigint,
  'Guild-B is absent before behavioral test setup'
);
select lives_ok(
  $$
    insert into public.infrastructure_clusters (id, site_id, name)
    values ('cascade-test', 'lag-1', 'Cascade test')
  $$,
  'a cluster can be prepared for cascade verification'
);
select lives_ok(
  $$
    insert into public.infrastructure_nodes (cluster_id, node)
    values ('cascade-test', 'node-a')
  $$,
  'a cluster-owned node can be prepared for cascade verification'
);
select lives_ok(
  $$
    insert into public.infrastructure_storage_targets
      (cluster_id, storage_id, shared)
    values ('cascade-test', 'shared', true)
  $$,
  'a cluster-owned storage target can be prepared for cascade verification'
);
select lives_ok(
  $$
    insert into public.catalog_image_cluster_templates
      (catalog_image_id, cluster_id, source_node, proxmox_vmid, storage_id,
       template_version)
    values ('ubuntu-2404', 'cascade-test', 'node-a', 9900, 'shared', 'test')
  $$,
  'a cluster-owned template can be prepared for cascade verification'
);
select lives_ok(
  $$ delete from public.infrastructure_clusters where id = 'cascade-test' $$,
  'a cluster can be deleted'
);
select is(
  (
    select count(*)
    from public.infrastructure_nodes
    where cluster_id = 'cascade-test'
  ),
  0::bigint,
  'deleting a cluster cascades to its nodes'
);
select is(
  (
    select count(*)
    from public.infrastructure_storage_targets
    where cluster_id = 'cascade-test'
  ),
  0::bigint,
  'deleting a cluster cascades to its storage targets'
);
select is(
  (
    select count(*)
    from public.catalog_image_cluster_templates
    where cluster_id = 'cascade-test'
  ),
  0::bigint,
  'deleting a cluster cascades to its template capabilities'
);

select is(
  (
    select array_agg(conname::text order by conname)
    from pg_constraint
    where conrelid in (
      'public.infrastructure_clusters'::regclass,
      'public.infrastructure_nodes'::regclass,
      'public.infrastructure_storage_targets'::regclass,
      'public.catalog_image_cluster_templates'::regclass,
      'public.placement_settings'::regclass
    )
      and contype = 'c'
  ),
  array[
    'catalog_image_cluster_templates_clone_mode_check',
    'catalog_image_cluster_templates_enabled_check',
    'infrastructure_clusters_admission_state_check',
    'infrastructure_nodes_admission_state_check',
    'infrastructure_nodes_capacity_nonnegative_check',
    'infrastructure_nodes_cpu_utilization_check',
    'infrastructure_storage_targets_bytes_nonnegative_check',
    'infrastructure_storage_targets_capacity_check',
    'infrastructure_storage_targets_topology_check',
    'placement_settings_id_check',
    'placement_settings_mode_check'
  ]::text[],
  'all new admission and capacity checks have explicit names'
);

select lives_ok(
  $$
    insert into public.infrastructure_clusters (id, site_id, name)
    values ('guild-b', 'lag-1', 'Guild-B')
  $$,
  'a paused cluster can be registered with safe defaults'
);
select results_eq(
  $$
    select enabled, admission_state, private_networking_healthy,
           backup_healthy, monitoring_healthy
    from public.infrastructure_clusters where id = 'guild-b'
  $$,
  $$ values (false, 'paused'::text, false, false, false) $$,
  'cluster defaults are closed and unhealthy'
);
select throws_ok(
  $$
    insert into public.infrastructure_clusters
      (id, site_id, name, admission_state)
    values ('bad-cluster', 'lag-1', 'Bad', 'unknown')
  $$,
  '23514',
  'new row for relation "infrastructure_clusters" violates check constraint "infrastructure_clusters_admission_state_check"',
  'cluster admission rejects unknown states'
);

select lives_ok(
  $$
    insert into public.infrastructure_nodes (cluster_id, node)
    values ('guild-b', 'podA')
  $$,
  'a node can be registered with safe defaults'
);
select results_eq(
  $$
    select enabled, admission_state, online, total_vcpu, committed_vcpu,
           total_memory_bytes, used_memory_bytes, committed_memory_bytes,
           cpu_utilization
    from public.infrastructure_nodes
    where cluster_id = 'guild-b' and node = 'podA'
  $$,
  $$ values
    (false, 'paused'::text, false, 0, 0, 0::bigint, 0::bigint, 0::bigint, 0::numeric)
  $$,
  'node defaults admit no workload and report no invented capacity'
);
select throws_ok(
  $$
    insert into public.infrastructure_nodes
      (cluster_id, node, admission_state)
    values ('guild-b', 'bad-state', 'unknown')
  $$,
  '23514',
  'new row for relation "infrastructure_nodes" violates check constraint "infrastructure_nodes_admission_state_check"',
  'node admission rejects unknown states'
);
select throws_ok(
  $$
    insert into public.infrastructure_nodes
      (cluster_id, node, total_vcpu)
    values ('guild-b', 'bad-capacity', -1)
  $$,
  '23514',
  'new row for relation "infrastructure_nodes" violates check constraint "infrastructure_nodes_capacity_nonnegative_check"',
  'node capacity rejects negative values'
);
select throws_ok(
  $$
    insert into public.infrastructure_nodes
      (cluster_id, node, cpu_utilization)
    values ('guild-b', 'bad-cpu', 1.01)
  $$,
  '23514',
  'new row for relation "infrastructure_nodes" violates check constraint "infrastructure_nodes_cpu_utilization_check"',
  'node CPU utilization rejects values above one'
);

select lives_ok(
  $$
    insert into public.infrastructure_storage_targets
      (cluster_id, storage_id, shared)
    values ('guild-b', 'shared-store', true)
  $$,
  'shared storage uses a null node'
);
select lives_ok(
  $$
    insert into public.infrastructure_storage_targets
      (cluster_id, storage_id, node, shared)
    values ('guild-b', 'local-store', 'podA', false)
  $$,
  'local storage uses an explicit node'
);
select throws_ok(
  $$
    insert into public.infrastructure_storage_targets
      (cluster_id, storage_id, node, shared)
    values ('guild-b', 'bad-shared', 'podA', true)
  $$,
  '23514',
  'new row for relation "infrastructure_storage_targets" violates check constraint "infrastructure_storage_targets_topology_check"',
  'shared storage rejects a node identity'
);
select throws_ok(
  $$
    insert into public.infrastructure_storage_targets
      (cluster_id, storage_id, shared)
    values ('guild-b', 'bad-local', false)
  $$,
  '23514',
  'new row for relation "infrastructure_storage_targets" violates check constraint "infrastructure_storage_targets_topology_check"',
  'local storage requires a node identity'
);
select throws_ok(
  $$
    insert into public.infrastructure_storage_targets
      (cluster_id, storage_id, shared, total_bytes)
    values ('guild-b', 'negative-store', true, -1)
  $$,
  '23514',
  'new row for relation "infrastructure_storage_targets" violates check constraint "infrastructure_storage_targets_bytes_nonnegative_check"',
  'storage rejects negative byte values'
);
select throws_ok(
  $$
    insert into public.infrastructure_storage_targets
      (cluster_id, storage_id, shared, total_bytes, used_bytes)
    values ('guild-b', 'overused-store', true, 100, 101)
  $$,
  '23514',
  'new row for relation "infrastructure_storage_targets" violates check constraint "infrastructure_storage_targets_capacity_check"',
  'storage rejects usage above a known total'
);
select lives_ok(
  $$
    insert into public.infrastructure_storage_targets
      (cluster_id, storage_id, node, shared)
    values ('guild-b', 'local-store', 'podB', false)
  $$,
  'the same local storage name can exist on another node'
);
select throws_ok(
  $$
    insert into public.infrastructure_storage_targets
      (cluster_id, storage_id, shared)
    values ('guild-b', 'shared-store', true)
  $$,
  '23505',
  'duplicate key value violates unique constraint "infrastructure_storage_targets_shared_key"',
  'shared storage identity is unique within a cluster'
);
select throws_ok(
  $$
    insert into public.infrastructure_storage_targets
      (cluster_id, storage_id, node, shared)
    values ('guild-b', 'local-store', 'podA', false)
  $$,
  '23505',
  'duplicate key value violates unique constraint "infrastructure_storage_targets_local_key"',
  'local storage identity is unique within a cluster and node'
);

select results_eq(
  $$
    select cluster_id, source_node, proxmox_vmid, storage_id, target_nodes,
           clone_mode, enabled, tested_at, template_version
    from public.catalog_image_cluster_templates
    where catalog_image_id = 'ubuntu-2404'
  $$,
  $$ values
    ('guild-a'::text, 'nodeD'::text, 9000, 'ceph-vm'::text, array[]::text[],
     'full'::text, false, null::timestamptz, 'legacy-guild-a'::text)
  $$,
  'the legacy lag-1 template is copied as a disabled Guild-A capability'
);
select is(
  (select count(*) from public.catalog_image_cluster_templates
   where catalog_image_id = 'debian-12'),
  0::bigint,
  'template rows from other sites are not copied into Guild-A'
);
select throws_ok(
  $$
    insert into public.catalog_image_cluster_templates
      (catalog_image_id, cluster_id, source_node, proxmox_vmid, storage_id,
       clone_mode, template_version)
    values ('debian-12', 'guild-b', 'podA', 9200, 'local-store',
            'incremental', 'test')
  $$,
  '23514',
  'new row for relation "catalog_image_cluster_templates" violates check constraint "catalog_image_cluster_templates_clone_mode_check"',
  'template capability rejects an unknown clone mode'
);
select throws_ok(
  $$
    insert into public.catalog_image_cluster_templates
      (catalog_image_id, cluster_id, source_node, proxmox_vmid, storage_id,
       target_nodes, enabled, template_version)
    values ('debian-12', 'guild-b', 'podA', 9200, 'local-store',
            array['podA'], true, 'test')
  $$,
  '23514',
  'new row for relation "catalog_image_cluster_templates" violates check constraint "catalog_image_cluster_templates_enabled_check"',
  'enabled template capability requires a tested timestamp'
);
select throws_ok(
  $$
    insert into public.catalog_image_cluster_templates
      (catalog_image_id, cluster_id, source_node, proxmox_vmid, storage_id,
       target_nodes, enabled, tested_at, template_version)
    values ('debian-12', 'guild-b', 'podA', 9200, 'local-store',
            array[]::text[], true, now(), 'test')
  $$,
  '23514',
  'new row for relation "catalog_image_cluster_templates" violates check constraint "catalog_image_cluster_templates_enabled_check"',
  'enabled template capability requires at least one tested target node'
);
select lives_ok(
  $$
    insert into public.catalog_image_cluster_templates
      (catalog_image_id, cluster_id, source_node, proxmox_vmid, storage_id,
       target_nodes, enabled, tested_at, template_version)
    values ('debian-12', 'guild-b', 'podA', 9200, 'local-store',
            array['podA'], true, now(), 'test')
  $$,
  'a tested template capability can be enabled'
);
select throws_ok(
  $$
    insert into public.catalog_image_cluster_templates
      (catalog_image_id, cluster_id, source_node, proxmox_vmid, storage_id,
       template_version)
    values ('fedora-41', 'guild-b', 'podA', 9200, 'local-store', 'test')
  $$,
  '23505',
  'duplicate key value violates unique constraint "catalog_image_cluster_templates_cluster_vmid_key"',
  'template VMIDs are unique inside a cluster'
);

select is(
  (select count(*) from public.placement_settings),
  1::bigint,
  'placement settings contains exactly one row'
);
select results_eq(
  $$ select id, mode from public.placement_settings $$,
  $$ values (true, 'single'::text) $$,
  'placement starts in single mode'
);
select throws_ok(
  $$ update public.placement_settings set mode = 'invalid' where id $$,
  '23514',
  'new row for relation "placement_settings" violates check constraint "placement_settings_mode_check"',
  'placement mode rejects unknown values'
);
select throws_ok(
  $$ insert into public.placement_settings (id) values (false) $$,
  '23514',
  'new row for relation "placement_settings" violates check constraint "placement_settings_id_check"',
  'placement settings rejects a second singleton identity'
);

select results_eq(
  $$
    select id, cluster_id, assigned_node, storage_id
    from public.operations
    order by id
  $$,
  $$ values
    ('00000000-0000-0000-0000-000000000001'::uuid, 'guild-a'::text, null::text, null::text),
    ('00000000-0000-0000-0000-000000000002'::uuid, 'guild-a'::text, null::text, null::text) $$,
  'existing operations are backfilled to Guild-A without invented placement'
);
select results_eq(
  $$
    select cluster_id, proxmox_vmid, proxmox_node
    from public.instances
    where id = '10000000-0000-0000-0000-000000000001'
  $$,
  $$ values ('guild-a'::text, 101, 'nodeD'::text) $$,
  'existing instance placement values remain unchanged after cluster backfill'
);
select results_eq(
  $$
    select cluster_id, storage_id
    from public.capacity_reservations
    where id = '20000000-0000-0000-0000-000000000001'
  $$,
  $$ values ('guild-a'::text, 'ceph-vm'::text) $$,
  'existing reservations are backfilled with Guild-A storage identity'
);
select is(
  (
    select count(*)
    from public.capacity_reservations
    where operation_id = '00000000-0000-0000-0000-000000000001'
      and state in ('held', 'committed')
  ),
  1::bigint,
  'duplicate legacy reservations are reconciled to one active row'
);
select results_eq(
  $$
    select id, state
    from public.capacity_reservations
    where operation_id = '00000000-0000-0000-0000-000000000001'
    order by id
  $$,
  $$ values
    ('20000000-0000-0000-0000-000000000001'::uuid, 'released'::text),
    ('20000000-0000-0000-0000-000000000002'::uuid, 'committed'::text),
    ('20000000-0000-0000-0000-000000000003'::uuid, 'released'::text) $$,
  'reconciliation preserves duplicate reservation history and committed precedence'
);
select results_eq(
  $$
    select cluster_id, proxmox_node
    from public.warm_pool_vms
    where id = '30000000-0000-0000-0000-000000000001'
  $$,
  $$ values ('guild-a'::text, 'nodeD'::text) $$,
  'existing warm VMs are backfilled without changing their node field'
);

select lives_ok(
  $$
    insert into public.instances (id, site_id, cluster_id, proxmox_vmid)
    values ('10000000-0000-0000-0000-000000000002',
            'lag-1', 'guild-b', 101)
  $$,
  'the same instance VMID can exist in another cluster'
);
select throws_ok(
  $$
    insert into public.instances (id, site_id, cluster_id, proxmox_vmid)
    values ('10000000-0000-0000-0000-000000000003',
            'lag-1', 'guild-a', 101)
  $$,
  '23505',
  'duplicate key value violates unique constraint "instances_cluster_vmid_key"',
  'an instance VMID cannot repeat inside a cluster'
);
select lives_ok(
  $$
    insert into public.warm_pool_vms
      (id, site_id, cluster_id, proxmox_vmid, proxmox_node)
    values ('30000000-0000-0000-0000-000000000002',
            'lag-1', 'guild-b', 201, 'podA')
  $$,
  'the same warm-pool VMID can exist in another cluster'
);
select throws_ok(
  $$
    insert into public.warm_pool_vms
      (id, site_id, cluster_id, proxmox_vmid, proxmox_node)
    values ('30000000-0000-0000-0000-000000000003',
            'lag-1', 'guild-a', 201, 'nodeD')
  $$,
  '23505',
  'duplicate key value violates unique constraint "warm_pool_vms_cluster_vmid_key"',
  'a warm-pool VMID cannot repeat inside a cluster'
);
select throws_ok(
  $$
    insert into public.capacity_reservations
      (id, operation_id, site_id, node, vcpu, memory_gb, disk_gb,
       cluster_id, storage_id)
    values ('20000000-0000-0000-0000-000000000020',
            '00000000-0000-0000-0000-000000000001',
            'lag-1', 'nodeD', 1, 1, 10, 'guild-a', 'ceph-vm')
  $$,
  '23505',
  'duplicate key value violates unique constraint "capacity_reservations_active_operation_key"',
  'a second active reservation for an operation conflicts'
);
select lives_ok(
  $$
    insert into public.capacity_reservations
      (id, operation_id, site_id, node, vcpu, memory_gb, disk_gb)
    values ('20000000-0000-0000-0000-000000000010',
            '00000000-0000-0000-0000-000000000002',
            'lag-1', 'nodeD', 1, 1, 10)
  $$,
  'the exact legacy reservation insert shape remains valid'
);
select results_eq(
  $$
    select cluster_id, storage_id
    from public.capacity_reservations
    where id = '20000000-0000-0000-0000-000000000010'
  $$,
  $$ values ('guild-a'::text, 'ceph-vm'::text) $$,
  'legacy reservation inserts receive Guild-A capacity defaults'
);
select throws_ok(
  $$
    insert into public.capacity_reservations
      (id, operation_id, site_id, node, vcpu, memory_gb, disk_gb)
    values ('20000000-0000-0000-0000-000000000011',
            '00000000-0000-0000-0000-000000000002',
            'lag-1', 'nodeD', 1, 1, 10)
  $$,
  '23505',
  'duplicate key value violates unique constraint "capacity_reservations_active_operation_key"',
  'a second legacy-shape active reservation conflicts'
);
select lives_ok(
  $$
    insert into public.capacity_reservations
      (id, operation_id, site_id, node, vcpu, memory_gb, disk_gb, state)
    values ('20000000-0000-0000-0000-000000000012',
            '00000000-0000-0000-0000-000000000002',
            'lag-1', 'nodeD', 1, 1, 10, 'released')
  $$,
  'released reservation history can share an operation with an active row'
);

select has_table(
  'public', 'catalog_image_site_templates',
  'site template compatibility table remains available'
);
select ok(
  has_table_privilege(
    'anon', 'public.catalog_image_site_templates', 'select'
  ),
  'anon retains compatibility reads'
);
select ok(
  has_table_privilege(
    'authenticated', 'public.catalog_image_site_templates', 'select'
  ),
  'authenticated retains compatibility reads'
);

select is(
  (
    select count(*)
    from pg_class
    where oid in (
      'public.infrastructure_clusters'::regclass,
      'public.infrastructure_nodes'::regclass,
      'public.infrastructure_storage_targets'::regclass,
      'public.catalog_image_cluster_templates'::regclass,
      'public.placement_settings'::regclass
    ) and relrowsecurity
  ),
  5::bigint,
  'row-level security is enabled on all new tables'
);

select table_privs_are(
  'public', 'infrastructure_clusters', 'anon', array[]::name[],
  'anon has no cluster privileges'
);
select table_privs_are(
  'public', 'infrastructure_nodes', 'anon', array[]::name[],
  'anon has no node privileges'
);
select table_privs_are(
  'public', 'infrastructure_storage_targets', 'anon', array[]::name[],
  'anon has no storage privileges'
);
select table_privs_are(
  'public', 'catalog_image_cluster_templates', 'anon', array[]::name[],
  'anon has no template capability privileges'
);
select table_privs_are(
  'public', 'placement_settings', 'anon', array[]::name[],
  'anon has no placement settings privileges'
);
select table_privs_are(
  'public', 'infrastructure_clusters', 'authenticated', array[]::name[],
  'authenticated has no cluster privileges'
);
select table_privs_are(
  'public', 'infrastructure_nodes', 'authenticated', array[]::name[],
  'authenticated has no node privileges'
);
select table_privs_are(
  'public', 'infrastructure_storage_targets', 'authenticated', array[]::name[],
  'authenticated has no storage privileges'
);
select table_privs_are(
  'public', 'catalog_image_cluster_templates', 'authenticated', array[]::name[],
  'authenticated has no template capability privileges'
);
select table_privs_are(
  'public', 'placement_settings', 'authenticated', array[]::name[],
  'authenticated has no placement settings privileges'
);

set local role anon;
select throws_ok(
  $$ insert into public.placement_settings default values $$,
  '42501'
);
reset role;

set local role authenticated;
select throws_ok(
  $$ insert into public.placement_settings default values $$,
  '42501'
);
reset role;

select ok(
  (select bool_and(has_table_privilege(
    'service_role', 'public.infrastructure_clusters', privilege
  )) from unnest(array['DELETE', 'INSERT', 'SELECT', 'UPDATE']) privilege),
  'service role can manage clusters'
);
select ok(
  (select bool_and(has_table_privilege(
    'service_role', 'public.infrastructure_nodes', privilege
  )) from unnest(array['DELETE', 'INSERT', 'SELECT', 'UPDATE']) privilege),
  'service role can manage nodes'
);
select ok(
  (select bool_and(has_table_privilege(
    'service_role', 'public.infrastructure_storage_targets', privilege
  )) from unnest(array['DELETE', 'INSERT', 'SELECT', 'UPDATE']) privilege),
  'service role can manage storage targets'
);
select ok(
  (select bool_and(has_table_privilege(
    'service_role', 'public.catalog_image_cluster_templates', privilege
  )) from unnest(array['DELETE', 'INSERT', 'SELECT', 'UPDATE']) privilege),
  'service role can manage template capabilities'
);
select ok(
  (select bool_and(has_table_privilege(
    'service_role', 'public.placement_settings', privilege
  )) from unnest(array['DELETE', 'INSERT', 'SELECT', 'UPDATE']) privilege),
  'service role can manage placement settings'
);

select * from finish(true);
rollback;
