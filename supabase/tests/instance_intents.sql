begin;
select plan(58);

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

-- Recovery from degraded. Every request RPC used to demand 'ready' exactly, so
-- a resize whose restart failed left the customer unable to resize, snapshot or
-- restore -- deletion was the only way out of a half-applied change.
set local role authenticated;
set local "request.jwt.claim.sub" = '20000000-0000-4000-8000-000000000001';
select lives_ok(
  $$select public.request_instance_resize(
      '40000000-0000-4000-8000-000000000001', 'std-2', 'degraded-recovery-resize')$$,
  'a degraded instance can be resized again rather than only deleted'
);
select is((select state from public.instances where id = '40000000-0000-4000-8000-000000000001'), 'resizing', 'recovering a degraded instance locks its state like any other resize');
reset role;
set local role service_role;
select lives_ok(
  $$select public.finish_instance_operation(
      (select id from public.operations where idempotency_key = 'degraded-recovery-resize'),
      'failed', '{}'::jsonb, 'still locked')$$,
  'a recovery attempt that fails again is recorded, not stuck'
);
reset role;

-- The guard was widened to 'degraded', not removed: an instance with work
-- genuinely in flight is still refused.
update public.instances set state = 'deleting' where id = '40000000-0000-4000-8000-000000000001';
set local role authenticated;
set local "request.jwt.claim.sub" = '20000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select public.request_instance_resize(
      '40000000-0000-4000-8000-000000000001', 'std-2', 'deleting-resize')$$,
  '55000',
  'instance is busy',
  'an instance that is deleting is still refused'
);
reset role;

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

-- ---------------------------------------------------------------------------
-- Operator cleanup across the tenant boundary
-- ---------------------------------------------------------------------------
-- Beta's instance stands in for abandoned infrastructure its owner is not
-- cleaning up. Alpha's owner is not a member of Beta.
reset role;
update public.instances set state = 'failed' where id = '40000000-0000-4000-8000-000000000002';

set local role authenticated;
set local "request.jwt.claim.sub" = '20000000-0000-4000-8000-000000000001';
select is(
  (select public.is_platform_operator()), false,
  'an ordinary user is not a platform operator'
);
select is(
  (select count(*) from public.operator_list_abandoned_instances()), 0::bigint,
  'a non-operator sees nothing in the abandoned listing, not even their own org'
);
select throws_ok(
  $$select public.request_instance_delete(
      '40000000-0000-4000-8000-000000000002', 'non-operator-delete')$$,
  '42501',
  'not authorized',
  'a non-operator cannot delete another organization''s instance'
);

reset role;
insert into public.platform_operators (user_id, note)
values ('20000000-0000-4000-8000-000000000009', 'test operator');

set local role authenticated;
set local "request.jwt.claim.sub" = '20000000-0000-4000-8000-000000000009';
select is(
  (select public.is_platform_operator()), true,
  'a user listed in platform_operators is recognised as one'
);
select is(
  (select count(*) from public.operator_list_abandoned_instances()), 1::bigint,
  'an operator sees abandoned infrastructure across the tenant boundary'
);
select lives_ok(
  $$select public.request_instance_delete(
      '40000000-0000-4000-8000-000000000002', 'operator-cleanup-1')$$,
  'an operator can request deletion of another organization''s instance'
);
select is(
  (select state from public.instances where id = '40000000-0000-4000-8000-000000000002'),
  'deleting',
  'the operator request moves the instance into the normal delete pipeline'
);

-- The tenant must be able to see that platform staff acted on their resource.
reset role;
select is(
  (select count(*) from public.audit_log
   where action = 'instance.delete.operator'
     and organization_id = '10000000-0000-4000-8000-000000000002'),
  1::bigint,
  'the operator delete is recorded in the tenant''s own audit log'
);
select is(
  (select actor_id from public.audit_log where action = 'instance.delete.operator'),
  '20000000-0000-4000-8000-000000000009'::uuid,
  'the audit event names the operator who acted'
);

-- Authority must not be grantable by the app itself.
select is(
  (select relrowsecurity from pg_class where oid = 'public.platform_operators'::regclass),
  true,
  'platform_operators has row level security enabled'
);
select is(
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'platform_operators'),
  0::bigint,
  'and carries no policy, so no client can read or widen it'
);

select ok(has_function_privilege('authenticated', 'public.is_org_member(uuid)', 'EXECUTE'), 'authenticated can execute the RLS membership helper');
select ok(not has_function_privilege('anon', 'public.is_org_member(uuid)', 'EXECUTE'), 'anon cannot execute the RLS membership helper');
select ok(not has_function_privilege('authenticated', 'public.finish_instance_operation(uuid,text,jsonb,text)', 'EXECUTE'), 'customers cannot finalize worker operations');

select * from finish();
rollback;
