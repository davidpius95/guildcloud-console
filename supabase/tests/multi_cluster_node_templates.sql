begin;

select no_plan();

select has_table(
  'public', 'catalog_image_cluster_node_templates',
  'per-node template resolution table exists'
);

select columns_are(
  'public', 'catalog_image_cluster_node_templates',
  array[
    'catalog_image_id', 'cluster_id', 'node', 'source_node', 'proxmox_vmid',
    'storage_id', 'clone_mode', 'enabled', 'tested_at', 'template_version',
    'created_at', 'updated_at'
  ]
);

select col_is_pk(
  'public', 'catalog_image_cluster_node_templates',
  array['catalog_image_id', 'cluster_id', 'node'],
  'per-node templates are keyed by image, cluster, and node'
);

select col_default_is(
  'public', 'catalog_image_cluster_node_templates', 'clone_mode', 'linked',
  'per-node templates default to a linked clone'
);
select col_default_is(
  'public', 'catalog_image_cluster_node_templates', 'enabled', 'false',
  'per-node templates are disabled until tested'
);

select col_is_fk(
  'public', 'catalog_image_cluster_node_templates', 'catalog_image_id',
  'per-node templates reference a real catalog image'
);
select col_is_fk(
  'public', 'catalog_image_cluster_node_templates', 'cluster_id',
  'per-node templates reference a real cluster'
);

-- Guild-A backfill: one row per legacy nodeD template, still disabled. This
-- fixture only seeds one lag-1 catalog_image_site_templates row
-- (ubuntu-2404), unlike the real six-image guild-a catalogue, so the
-- expected count here is fixture-sized, not production-sized.
select results_eq(
  $$
    select count(*)::int from public.catalog_image_cluster_node_templates
    where cluster_id = 'guild-a' and node = 'nodeD' and not enabled
  $$,
  $$ values (1) $$,
  'guild-a is backfilled with one disabled per-node row per legacy template'
);

select lives_ok(
  $$
    insert into public.catalog_image_cluster_node_templates
      (catalog_image_id, cluster_id, node, source_node, proxmox_vmid,
       storage_id, clone_mode, enabled, tested_at, template_version)
    values
      ('ubuntu-2404', 'guild-a', 'nodeA', 'nodeD', 9020, 'ceph-vm', 'linked',
       true, now(), 'v1')
  $$,
  'a per-node template can be registered enabled once tested'
);

select throws_ok(
  $$
    insert into public.catalog_image_cluster_node_templates
      (catalog_image_id, cluster_id, node, source_node, proxmox_vmid,
       storage_id, clone_mode, enabled, template_version)
    values
      ('ubuntu-2404', 'guild-a', 'nodeB', 'nodeD', 9021, 'ceph-vm', 'linked',
       true, 'v1')
  $$,
  '23514',
  null,
  'enabling a per-node template without a tested_at timestamp is rejected'
);

select throws_ok(
  $$
    insert into public.catalog_image_cluster_node_templates
      (catalog_image_id, cluster_id, node, source_node, proxmox_vmid,
       storage_id, clone_mode, template_version)
    values
      ('ubuntu-2404', 'guild-a', 'nodeC', 'nodeD', 9022, 'ceph-vm', 'sideways',
       'v1')
  $$,
  '23514',
  null,
  'clone_mode rejects anything other than linked or full'
);

select throws_ok(
  $$
    insert into public.catalog_image_cluster_node_templates
      (catalog_image_id, cluster_id, node, source_node, proxmox_vmid,
       storage_id, template_version)
    values
      ('debian-12', 'guild-a', 'nodeE', 'nodeD', 9020, 'ceph-vm', 'v1')
  $$,
  '23505',
  null,
  'the same VMID cannot be registered twice within a cluster, even on a different node'
);

-- The invariant that keeps placement honest: every node a cluster template
-- claims to admit (target_nodes) must have a matching enabled row here, or
-- the RPC can pick a node the worker has no template to clone from.
select lives_ok(
  $$
    update public.catalog_image_cluster_node_templates
    set enabled = true, tested_at = now()
    where catalog_image_id = 'ubuntu-2404' and cluster_id = 'guild-a' and node = 'nodeD'
  $$,
  'the backfilled nodeD row can be marked tested and enabled'
);
select lives_ok(
  $$
    update public.catalog_image_cluster_templates
    set target_nodes = array['nodeD', 'nodeA'], enabled = true, tested_at = now()
    where catalog_image_id = 'ubuntu-2404' and cluster_id = 'guild-a'
  $$,
  'admitting nodeD and nodeA for ubuntu-2404 on guild-a (both have resolvable per-node templates from this fixture)'
);
select is_empty(
  $$
    select t.catalog_image_id, t.cluster_id, t.node
    from (
      select catalog_image_id, cluster_id, unnest(target_nodes) as node
      from public.catalog_image_cluster_templates
      where enabled
    ) t
    left join public.catalog_image_cluster_node_templates n
      on n.catalog_image_id = t.catalog_image_id
      and n.cluster_id = t.cluster_id
      and n.node = t.node
      and n.enabled
    where n.node is null
  $$,
  'every admitted target node has a matching enabled per-node template to clone from'
);

-- Nothing at the database level stops an operator from admitting a node
-- with no matching per-node template (there is no trigger for it) - that is
-- exactly why the is_empty query above exists as a standing health check
-- rather than a one-time constraint. Prove it can actually catch a real
-- violation, not just pass on the fixture's already-consistent state.
select isnt_empty(
  $$
    update public.catalog_image_cluster_templates
    set target_nodes = array['nodeD', 'nodeF'], enabled = true, tested_at = now()
    where catalog_image_id = 'ubuntu-2404' and cluster_id = 'guild-a'
    returning 1
  $$,
  'the setup step for the negative case below applies cleanly'
);
select is(
  (
    select array_agg(t.node order by t.node)
    from (
      select catalog_image_id, cluster_id, unnest(target_nodes) as node
      from public.catalog_image_cluster_templates
      where enabled
    ) t
    left join public.catalog_image_cluster_node_templates n
      on n.catalog_image_id = t.catalog_image_id
      and n.cluster_id = t.cluster_id
      and n.node = t.node
      and n.enabled
    where n.node is null
  ),
  array['nodeF'],
  'admitting nodeF with no per-node template is caught by the invariant query'
);
select lives_ok(
  $$
    update public.catalog_image_cluster_templates
    set target_nodes = array['nodeD', 'nodeA'], enabled = true, tested_at = now()
    where catalog_image_id = 'ubuntu-2404' and cluster_id = 'guild-a'
  $$,
  'restoring a consistent admitted set'
);

select is(
  (
    select relrowsecurity from pg_class
    where oid = 'public.catalog_image_cluster_node_templates'::regclass
  ),
  true,
  'row level security is enabled on per-node templates'
);
select table_privs_are(
  'public', 'catalog_image_cluster_node_templates', 'anon', array[]::name[],
  'anon has no per-node template privileges'
);
select table_privs_are(
  'public', 'catalog_image_cluster_node_templates', 'authenticated', array[]::name[],
  'authenticated has no per-node template privileges'
);
select ok(
  (select bool_and(has_table_privilege(
    'service_role', 'public.catalog_image_cluster_node_templates', privilege
  )) from unnest(array['DELETE', 'INSERT', 'SELECT', 'UPDATE']) privilege),
  'service role can manage per-node templates'
);

select * from finish(true);
rollback;
