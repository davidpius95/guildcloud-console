begin;

select no_plan();

-- guild-a already exists in infrastructure_clusters (seeded by
-- 20260818090000_add_multi_cluster_placement.sql) - only its nodes and
-- storage targets need registering here.
insert into public.infrastructure_nodes (cluster_id, node)
values ('guild-a', 'nodeD'), ('guild-a', 'nodeA');

insert into public.infrastructure_storage_targets
  (cluster_id, storage_id, node, shared)
values
  ('guild-a', 'ceph-vm', null, true),
  ('guild-a', 'local', 'nodeD', false);

-- touch_worker_heartbeat --------------------------------------------------

select lives_ok(
  $$ select public.touch_worker_heartbeat('guild-a', 'guild-a-lxc-500') $$,
  'heartbeat can be touched for a real cluster'
);
select results_eq(
  $$ select worker_id from public.infrastructure_clusters where id = 'guild-a' $$,
  $$ values ('guild-a-lxc-500'::text) $$,
  'heartbeat records the worker id'
);
select ok(
  (
    select worker_heartbeat_at > now() - interval '5 seconds'
    from public.infrastructure_clusters where id = 'guild-a'
  ),
  'heartbeat timestamp is fresh'
);
select throws_ok(
  $$ select public.touch_worker_heartbeat('guild-nonexistent', 'w1') $$,
  '22023',
  null,
  'heartbeat for an unknown cluster is rejected'
);
select throws_ok(
  $$ select public.touch_worker_heartbeat(null, 'w1') $$,
  '22023',
  'cluster_id and worker_id are required.',
  'heartbeat requires a cluster id'
);

-- publish_cluster_snapshot: cluster-identity rejection ---------------------

select throws_ok(
  $$
    select public.publish_cluster_snapshot(
      'guild-a',
      '{"cluster_id": "guild-b", "nodes": [], "storage_targets": []}'::jsonb
    )
  $$,
  '22023',
  null,
  'a snapshot claiming a different cluster than the caller is rejected'
);
select throws_ok(
  $$ select public.publish_cluster_snapshot('guild-nonexistent', '{}'::jsonb) $$,
  '22023',
  null,
  'publishing for an unknown cluster is rejected'
);

-- publish_cluster_snapshot: unknown node/storage rejection -----------------
-- This is the guard against a compromised or misconfigured worker inventing
-- capacity: it can only report on rows an operator already registered.

select throws_ok(
  $$
    select public.publish_cluster_snapshot(
      'guild-a',
      '{"cluster_id": "guild-a", "nodes": [{"node": "nodeNeverRegistered", "online": true}], "storage_targets": []}'::jsonb
    )
  $$,
  '22023',
  null,
  'publishing capacity for an unregistered node is rejected'
);
select throws_ok(
  $$
    select public.publish_cluster_snapshot(
      'guild-a',
      '{"cluster_id": "guild-a", "nodes": [], "storage_targets": [{"storage_id": "phantom-storage", "node": null}]}'::jsonb
    )
  $$,
  '22023',
  null,
  'publishing capacity for an unregistered storage target is rejected'
);

-- publish_cluster_snapshot: real publish -----------------------------------

select lives_ok(
  $$
    select public.publish_cluster_snapshot(
      'guild-a',
      '{
        "cluster_id": "guild-a",
        "nodes": [
          {"node": "nodeD", "online": true, "total_vcpu": 4, "committed_vcpu": 1,
           "total_memory_bytes": 16648900608, "used_memory_bytes": 12874240000,
           "committed_memory_bytes": 2147483648, "cpu_utilization": 0.065}
        ],
        "storage_targets": [
          {"storage_id": "ceph-vm", "node": null, "total_bytes": 500000000000, "used_bytes": 100000000000},
          {"storage_id": "local", "node": "nodeD", "total_bytes": 72722055168, "used_bytes": 11876524032}
        ],
        "private_networking_healthy": true,
        "backup_healthy": true,
        "monitoring_healthy": false
      }'::jsonb
    )
  $$,
  'a valid snapshot for registered nodes and storage publishes cleanly'
);

select results_eq(
  $$
    select online, total_vcpu, committed_vcpu, total_memory_bytes,
           used_memory_bytes, committed_memory_bytes
    from public.infrastructure_nodes where cluster_id = 'guild-a' and node = 'nodeD'
  $$,
  $$
    values (true, 4, 1, 16648900608::bigint, 12874240000::bigint, 2147483648::bigint)
  $$,
  'node capacity is written from the snapshot'
);

select results_eq(
  $$
    select total_bytes, used_bytes, healthy
    from public.infrastructure_storage_targets
    where cluster_id = 'guild-a' and storage_id = 'ceph-vm'
  $$,
  $$ values (500000000000::bigint, 100000000000::bigint, true) $$,
  'shared storage capacity is written from the snapshot'
);

select ok(
  (
    select capacity_observed_at > now() - interval '5 seconds'
      and private_networking_healthy and backup_healthy and not monitoring_healthy
    from public.infrastructure_clusters where id = 'guild-a'
  ),
  'cluster-level health booleans and capacity_observed_at are updated honestly, not assumed true'
);

-- publish_cluster_snapshot never touches operator-owned admission fields ---

update public.infrastructure_nodes set enabled = false, admission_state = 'paused'
where cluster_id = 'guild-a' and node = 'nodeD';
select public.publish_cluster_snapshot(
  'guild-a',
  '{"cluster_id": "guild-a", "nodes": [{"node": "nodeD", "online": true}], "storage_targets": []}'::jsonb
);
select results_eq(
  $$
    select enabled, admission_state from public.infrastructure_nodes
    where cluster_id = 'guild-a' and node = 'nodeD'
  $$,
  $$ values (false, 'paused'::text) $$,
  'publishing a snapshot never flips operator-owned enabled/admission_state, even though online is now true'
);

-- privileges ----------------------------------------------------------------

select function_privs_are(
  'public', 'touch_worker_heartbeat', array['text', 'text'], 'anon', array[]::name[],
  'anon cannot touch a worker heartbeat'
);
select function_privs_are(
  'public', 'touch_worker_heartbeat', array['text', 'text'], 'authenticated', array[]::name[],
  'authenticated cannot touch a worker heartbeat'
);
select function_privs_are(
  'public', 'touch_worker_heartbeat', array['text', 'text'], 'service_role', array['EXECUTE'],
  'service role can touch a worker heartbeat'
);
select function_privs_are(
  'public', 'publish_cluster_snapshot', array['text', 'jsonb'], 'anon', array[]::name[],
  'anon cannot publish a cluster snapshot'
);
select function_privs_are(
  'public', 'publish_cluster_snapshot', array['text', 'jsonb'], 'authenticated', array[]::name[],
  'authenticated cannot publish a cluster snapshot'
);
select function_privs_are(
  'public', 'publish_cluster_snapshot', array['text', 'jsonb'], 'service_role', array['EXECUTE'],
  'service role can publish a cluster snapshot'
);

select * from finish(true);
rollback;
