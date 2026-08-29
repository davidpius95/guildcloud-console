begin;
select plan(43);

select has_function('public', 'request_instance_create', array['uuid','uuid','uuid','text','text','text','text','boolean','text']);
select has_function('public', 'request_instance_snapshot', array['uuid','text','text']);
select has_function('public', 'request_instance_resize', array['uuid','text','text']);
select has_function('public', 'request_instance_restore_replace', array['uuid','uuid','text']);
select has_function('public', 'request_instance_deletion', array['uuid','text']);
select has_function('public', 'finish_instance_operation', array['uuid','text','jsonb','text']);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'operations_one_active_per_instance_idx'
  ),
  'one active operation per instance is enforced by an index'
);

select lives_ok(
  $$insert into public.instances
      (id, organization_id, project_id, site_id, name, catalog_image_id, catalog_plan_id, state)
    values
      ('40000000-0000-4000-8000-000000000099', '10000000-0000-4000-8000-000000000001',
       '30000000-0000-4000-8000-000000000001', 'lag-1', 'state-contract',
       'ubuntu-2404', 'std-1', 'snapshotting')$$,
  'snapshotting is a valid guarded lifecycle state'
);

set local role authenticated;
set local "request.jwt.claim.sub" = '20000000-0000-4000-8000-000000000001';

select lives_ok(
  $$select * from public.request_instance_create(
      '41000000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'lag-1', 'created-atomically', 'ubuntu-2404', 'std-1', false,
      'create-key-1')$$,
  'owner can atomically request instance creation'
);
select is((select count(*)::integer from public.instances where id = '41000000-0000-4000-8000-000000000001'), 1, 'create inserts one instance');
select is((select count(*)::integer from public.operations where idempotency_key = 'create-key-1'), 1, 'create inserts one operation');
select is((select count(*)::integer from public.operation_stages where operation_id = '61000000-0000-4000-8000-000000000001'), 10, 'create inserts all ten durable stages');
select lives_ok(
  $$select * from public.request_instance_create(
      '41000000-0000-4000-8000-000000000009',
      '61000000-0000-4000-8000-000000000009',
      '30000000-0000-4000-8000-000000000001',
      'lag-1', 'duplicate-submit', 'ubuntu-2404', 'std-1', false,
      'create-key-1')$$,
  'create idempotency replay succeeds'
);
select is((select count(*)::integer from public.instances where id in ('41000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000009')), 1, 'idempotency replay creates no second instance');

set local "request.jwt.claim.sub" = '20000000-0000-4000-8000-000000000003';
select throws_ok(
  $$select * from public.request_instance_create(
      '41000000-0000-4000-8000-000000000003',
      '61000000-0000-4000-8000-000000000003',
      '30000000-0000-4000-8000-000000000001',
      'lag-1', 'developer-denied', 'ubuntu-2404', 'std-1', false,
      'developer-create')$$,
  '42501',
  'not authorized',
  'developer cannot create an instance'
);

set local "request.jwt.claim.sub" = '20000000-0000-4000-8000-000000000001';
select lives_ok(
  $$select public.request_instance_snapshot(
      '40000000-0000-4000-8000-000000000001', 'before-upgrade', 'snapshot-key-1')$$,
  'owner can atomically request a snapshot'
);
select is((select state from public.instances where id = '40000000-0000-4000-8000-000000000001'), 'snapshotting', 'snapshot intent locks the instance state');
select is((select state from public.instance_snapshots where id = ((select stages->>'snapshot_id' from public.operations where idempotency_key = 'snapshot-key-1'))::uuid), 'creating', 'snapshot record starts as creating');
select is((select count(*)::integer from public.operation_stages where operation_id = (select id from public.operations where idempotency_key = 'snapshot-key-1')), 10, 'snapshot intent inserts all ten stages atomically');
select throws_ok(
  $$select public.request_instance_restore_replace(
      '40000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000001', 'restore-while-busy')$$,
  '55000',
  'instance is busy',
  'restore cannot race an active snapshot operation'
);

reset role;
set local role service_role;
select lives_ok(
  $$select public.finish_instance_operation(
      (select id from public.operations where idempotency_key = 'snapshot-key-1'),
      'succeeded', '{}'::jsonb, null)$$,
  'worker completion finalizes a successful snapshot'
);
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '20000000-0000-4000-8000-000000000001';
select is((select state from public.instances where id = '40000000-0000-4000-8000-000000000001'), 'ready', 'successful snapshot returns instance to ready');
select is((select state from public.instance_snapshots where id = ((select stages->>'snapshot_id' from public.operations where idempotency_key = 'snapshot-key-1'))::uuid), 'ready', 'successful snapshot becomes ready');

select throws_ok(
  $$select public.request_instance_restore_replace(
      '40000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000003', 'cross-instance-restore')$$,
  '22023',
  'snapshot is not a ready recovery point for this instance',
  'restore rejects another organization and instance snapshot'
);
select throws_ok(
  $$select public.request_instance_restore_replace(
      '40000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000002', 'creating-snapshot-restore')$$,
  '22023',
  'snapshot is not a ready recovery point for this instance',
  'restore rejects a snapshot that is not ready'
);
select lives_ok(
  $$select public.request_instance_restore_replace(
      '40000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000001', 'restore-key-1')$$,
  'restore accepts a ready snapshot owned by the instance'
);
select is((select state from public.instances where id = '40000000-0000-4000-8000-000000000001'), 'restoring', 'restore intent locks the instance state');

reset role;
set local role service_role;
select lives_ok(
  $$select public.finish_instance_operation(
      (select id from public.operations where idempotency_key = 'restore-key-1'),
      'failed', '{}'::jsonb, 'rollback task failed')$$,
  'worker can record failed restore outcome'
);
reset role;
select is((select state from public.instances where id = '40000000-0000-4000-8000-000000000001'), 'degraded', 'failed restore leaves the instance degraded');
update public.instances set state = 'ready' where id = '40000000-0000-4000-8000-000000000001';

set local role authenticated;
set local "request.jwt.claim.sub" = '20000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select public.request_instance_resize(
      '40000000-0000-4000-8000-000000000001', 'std-down', 'resize-down')$$,
  '22023',
  'resize target must not reduce cpu, memory, or disk',
  'resize rejects any resource downgrade'
);
select lives_ok(
  $$select public.request_instance_resize(
      '40000000-0000-4000-8000-000000000001', 'std-2', 'resize-key-1')$$,
  'owner can request an upward resize'
);
select is((select state from public.instances where id = '40000000-0000-4000-8000-000000000001'), 'resizing', 'resize intent locks the instance state');
select throws_ok(
  $$select public.request_instance_deletion(
      '40000000-0000-4000-8000-000000000001', 'delete-while-resizing')$$,
  '55000',
  'instance is busy',
  'delete cannot race an active resize'
);

reset role;
set local role service_role;
select lives_ok(
  $$select public.finish_instance_operation(
      (select id from public.operations where idempotency_key = 'resize-key-1'),
      'succeeded', '{"vcpu":2,"memory_gb":4,"disk_gb":80}'::jsonb, null)$$,
  'worker completion finalizes a verified resize'
);
reset role;
select results_eq(
  $$select state, catalog_plan_id from public.instances where id = '40000000-0000-4000-8000-000000000001'$$,
  $$values ('ready'::text, 'std-2'::text)$$,
  'successful resize publishes the new plan only at completion'
);

set local role authenticated;
set local "request.jwt.claim.sub" = '20000000-0000-4000-8000-000000000001';
select lives_ok(
  $$select public.request_instance_deletion(
      '40000000-0000-4000-8000-000000000001', 'delete-key-1')$$,
  'owner can request deletion when no operation is active'
);
select is((select state from public.instances where id = '40000000-0000-4000-8000-000000000001'), 'deleting', 'delete intent locks the instance state');
select results_eq(
  $$select public.request_instance_deletion(
      '40000000-0000-4000-8000-000000000001', 'delete-key-1')$$,
  $$select id from public.operations where idempotency_key = 'delete-key-1'$$,
  'repeating a deletion request returns the original operation'
);

reset role;
set local role service_role;
select lives_ok(
  $$select public.finish_instance_operation(
      (select id from public.operations where idempotency_key = 'delete-key-1'),
      'succeeded', '{"infrastructure_absent":true}'::jsonb, null)$$,
  'worker completion atomically finalizes deletion'
);
reset role;
select is(
  (select count(*) from public.instances where id = '40000000-0000-4000-8000-000000000001'),
  0::bigint,
  'successful infrastructure deletion removes the instance row'
);

select ok(has_function_privilege('authenticated', 'public.is_org_member(uuid)', 'EXECUTE'), 'authenticated can execute the RLS membership helper');
select ok(not has_function_privilege('anon', 'public.is_org_member(uuid)', 'EXECUTE'), 'anon cannot execute the RLS membership helper');
select ok(not has_function_privilege('authenticated', 'public.finish_instance_operation(uuid,text,jsonb,text)', 'EXECUTE'), 'customers cannot finalize worker operations');

select * from finish();
rollback;
