begin;

select no_plan();

insert into public.instances (id, site_id, cluster_id, proxmox_node, storage_id, proxmox_vmid)
values ('40000000-0000-0000-0000-000000000001', 'lag-1', 'guild-a', 'nodeD', 'ceph-vm', 501);

-- route_operation_by_instance: lifecycle kinds are stamped from the instance --

select lives_ok(
  $$
    insert into public.operations (id, site_id, instance_id, kind, state)
    values ('50000000-0000-0000-0000-000000000001', 'lag-1',
            '40000000-0000-0000-0000-000000000001', 'instance.resize', 'pending')
  $$,
  'a resize operation for a placed instance can be inserted without specifying cluster_id'
);
select results_eq(
  $$
    select cluster_id, assigned_node, storage_id from public.operations
    where id = '50000000-0000-0000-0000-000000000001'
  $$,
  $$ values ('guild-a'::text, 'nodeD'::text, 'ceph-vm'::text) $$,
  'the trigger stamps cluster_id/assigned_node/storage_id from the instance'
);

select throws_ok(
  $$
    insert into public.operations (id, site_id, instance_id, kind, state, cluster_id)
    values ('50000000-0000-0000-0000-000000000002', 'lag-1',
            '40000000-0000-0000-0000-000000000001', 'instance.snapshot', 'pending', 'guild-b')
  $$,
  '22023',
  null,
  'a lifecycle operation cannot claim a different cluster than its instance actually lives on'
);

select throws_ok(
  $$
    insert into public.operations (id, site_id, instance_id, kind, state)
    values ('50000000-0000-0000-0000-000000000003', 'lag-1', null, 'instance.snapshot', 'pending')
  $$,
  '22023',
  null,
  'a lifecycle operation without an instance_id is rejected rather than silently unrouted'
);

select throws_ok(
  $$
    insert into public.operations (id, site_id, instance_id, kind, state)
    values ('50000000-0000-0000-0000-000000000004', 'lag-1',
            '90000000-0000-0000-0000-000000000099', 'instance.snapshot', 'pending')
  $$,
  '22023',
  null,
  'a lifecycle operation for a nonexistent instance is rejected'
);

-- route_operation_by_instance: creates are left alone --------------------

select lives_ok(
  $$
    insert into public.operations (id, site_id, instance_id, kind, state)
    values ('50000000-0000-0000-0000-000000000005', 'lag-1', null, 'instance.create', 'pending')
  $$,
  'a create operation with no instance yet can be inserted'
);
select results_eq(
  $$
    select cluster_id from public.operations
    where id = '50000000-0000-0000-0000-000000000005'
  $$,
  $$ values (null::text) $$,
  'a create operation is left cluster-null so placement owns the assignment'
);

-- catalog_image_site_availability(): unions real capability and legacy ----

select lives_ok(
  $$
    select public.catalog_image_site_availability()
  $$,
  'the availability RPC can be called by an unprivileged caller shape'
);
select results_eq(
  $$
    select catalog_image_id, site_id
    from public.catalog_image_site_availability()
    where catalog_image_id = 'ubuntu-2404' and site_id = 'lag-1'
  $$,
  $$ values ('ubuntu-2404'::text, 'lag-1'::text) $$,
  'ubuntu-2404 at lag-1 is available via the legacy catalog_image_site_templates fallback'
);
select is_empty(
  $$
    select 1 from public.catalog_image_site_availability()
    where catalog_image_id = 'debian-12' and site_id = 'lag-1'
  $$,
  'an image/site combination with neither a real capability nor a legacy template is not available (debian-12''s only legacy row is at other-site, not lag-1)'
);

-- fedora-41 has no legacy lag-1 template in this fixture (only ubuntu-2404
-- does), so it has no backfilled row here yet - insert one directly to
-- prove the real-capability path independent of the legacy fallback.
insert into public.catalog_image_cluster_templates
  (catalog_image_id, cluster_id, source_node, proxmox_vmid, storage_id,
   target_nodes, clone_mode, enabled, tested_at, template_version)
values
  ('fedora-41', 'guild-a', 'nodeA', 9003, 'ceph-vm', array['nodeA'], 'linked',
   true, now(), 'v1');
select results_eq(
  $$
    select catalog_image_id, site_id
    from public.catalog_image_site_availability()
    where catalog_image_id = 'fedora-41'
  $$,
  $$ values ('fedora-41'::text, 'lag-1'::text) $$,
  'enabling a real cluster capability makes the image available at its cluster''s site, with no legacy row needed'
);

select function_privs_are(
  'public', 'catalog_image_site_availability', array[]::name[], 'anon', array['EXECUTE'],
  'anon can call the availability RPC (it deliberately exposes no cluster/node identity)'
);
select function_privs_are(
  'public', 'catalog_image_site_availability', array[]::name[], 'authenticated', array['EXECUTE'],
  'authenticated can call the availability RPC'
);

select * from finish(true);
rollback;
