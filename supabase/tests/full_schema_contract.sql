-- Full-schema contract: what must be true of a database built ONLY from this
-- repository -- the baseline plus every tracked migration, in filename order,
-- against an empty Postgres 17.
--
-- Why this exists: on 2026-08-29 applying the migration chain to an empty
-- database failed 29 times out of 42. Phase 1 built the first control-plane
-- objects straight against the hosted project, so migration history began
-- mid-schema and the repository could not rebuild its own database. Nothing
-- surfaced it, because the live system had the missing objects and every later
-- migration was written against a database that already did too.
--
-- The baseline fixed that once. This file is what keeps it fixed. A migration
-- that quietly depends on a live-only object, or that drops a grant the console
-- needs, fails here rather than in a new environment months later.
--
-- Deliberately NOT covered here (the fixture suites already own them, and run
-- faster): placement scoring, lifecycle intents, and the worker RPC boundary.
-- See scripts/test-multi-cluster-schema.sh, test-instance-intents.sh and
-- test-worker-boundary.sh. This suite asks a different question -- "can the
-- repository produce a correct database at all" -- not "does this RPC behave".

begin;
-- Pinned rather than no_plan(): a dropped assertion should fail the suite, not
-- quietly shrink it. Update deliberately when adding coverage.
select plan(94);

-- ---------------------------------------------------------------------------
-- 1. The Phase 1 foundation exists at all
--
-- These eight tables were the ones missing from migration history. If any of
-- them stops being created, the chain has regressed to the 2026-08-29 state.
-- ---------------------------------------------------------------------------

select has_table('public', 'organizations', 'organizations is built from the repository');
select has_table('public', 'memberships',   'memberships is built from the repository');
select has_table('public', 'projects',      'projects is built from the repository');
select has_table('public', 'audit_log',     'audit_log is built from the repository');
select has_table('public', 'access_grants', 'access_grants is built from the repository');
select has_table('public', 'catalog_plans', 'catalog_plans is built from the repository');
select has_table('public', 'catalog_images','catalog_images is built from the repository');
select has_table('public', 'operations',    'operations is built from the repository');

-- The columns later migrations add to the baseline's reduced shapes. Each of
-- these is an `alter table` that would silently no-op or fail if the baseline
-- were ever regenerated from the CURRENT production shape instead of the
-- pre-migration one.
select has_column('public', 'operations', 'idempotency_key',  'operations.idempotency_key survives the chain');
select has_column('public', 'operations', 'instance_id',      'operations.instance_id survives the chain');
select has_column('public', 'operations', 'site_id',          'operations.site_id survives the chain');
select has_column('public', 'operations', 'cluster_id',       'operations.cluster_id survives the chain');
select has_column('public', 'operations', 'placement_decision','operations.placement_decision survives the chain');
select has_column('public', 'projects',   'slug',             'projects.slug survives the chain');
select has_column('public', 'projects',   'tailscale_acl_state', 'projects.tailscale_acl_state survives the chain');

-- Columns that existed only in production until the baseline repair.
select has_column('public', 'instances', 'ssh_keys_sync_pending', 'instances.ssh_keys_sync_pending is repository-built');
select has_column('public', 'instances', 'updated_at',            'instances.updated_at is repository-built');

-- 20260829190000 adds updated_at NULLABLE with no backfill on purpose: NULL
-- means "not updated since the column was added". A default would reintroduce
-- the plausible-but-wrong timestamp that migration exists to remove, and
-- because it uses `add column if not exists`, an earlier migration adding the
-- column WITH a default would silently win. This assertion is the guard.
select col_is_null('public', 'instances', 'updated_at',
  'instances.updated_at stays nullable -- a default would resurrect the bug 20260829190000 fixed');

-- The state default and check constraint the baseline deliberately gets wrong,
-- and later migrations correct. Asserting the END state proves the corrections
-- actually ran rather than being skipped as no-ops.
select col_default_is('public', 'operations', 'state', 'pending',
  'operations.state defaults to pending, not the baseline''s running');

select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'operations_state_check'
      and pg_get_constraintdef(oid) like '%pending%'
  ),
  'operations_state_check admits pending after 20260808200100 rewrites it'
);

-- ---------------------------------------------------------------------------
-- 2. RLS is enabled everywhere it must be
--
-- A table that loses RLS is readable by every signed-in user in every other
-- organization. Cheap to assert, catastrophic to miss.
-- ---------------------------------------------------------------------------

select ok(relrowsecurity, format('RLS is enabled on public.%s', relname))
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('organizations','memberships','projects','audit_log','access_grants',
                  'catalog_plans','catalog_images','operations','instances','ssh_keys',
                  'instance_snapshots','capacity_reservations','worker_identities')
order by relname;

-- ---------------------------------------------------------------------------
-- 3. Exact EXECUTE privileges
--
-- SECURITY DEFINER functions run as their owner, so an unintended anon grant is
-- a privilege escalation, not a style problem. 20260829150000 exists because
-- three of them had been left open. These assertions encode the intended
-- posture, verified against the production project on 2026-08-30.
-- ---------------------------------------------------------------------------

-- The RLS helpers. Every policy in the system routes through these.
select ok(     has_function_privilege('authenticated', 'public.is_org_member(uuid)', 'execute'),
  'authenticated may execute is_org_member');
select ok(not  has_function_privilege('anon',          'public.is_org_member(uuid)', 'execute'),
  'anon may NOT execute is_org_member');
select ok(     has_function_privilege('authenticated', 'public.has_org_role(uuid, text[])', 'execute'),
  'authenticated may execute has_org_role');
select ok(not  has_function_privilege('anon',          'public.has_org_role(uuid, text[])', 'execute'),
  'anon may NOT execute has_org_role');

-- The only insert path into the append-only audit log.
select ok(     has_function_privilege('authenticated',
  'public.log_audit_event(uuid, text, uuid, text, text, jsonb)', 'execute'),
  'authenticated may execute log_audit_event');
select ok(not  has_function_privilege('anon',
  'public.log_audit_event(uuid, text, uuid, text, text, jsonb)', 'execute'),
  'anon may NOT execute log_audit_event');

-- Customer-callable lifecycle RPCs: signed-in only, never anon.
select ok(has_function_privilege('authenticated', fn, 'execute'), format('authenticated may execute %s', fn))
from unnest(array[
  'public.request_instance_create(uuid, uuid, uuid, text, text, text, text, boolean, text)',
  'public.request_instance_snapshot(uuid, text, text)',
  'public.request_instance_resize(uuid, text, text)',
  'public.request_instance_restore_replace(uuid, uuid, text)',
  'public.request_instance_deletion(uuid, text)',
  'public.reveal_instance_ssh_password(uuid)',
  'public.mark_org_instances_ssh_dirty(uuid)',
  'public.can_provision_instance(text, text, text)',
  'public.accept_invite(text)'
]) as fn;

select ok(not has_function_privilege('anon', fn, 'execute'), format('anon may NOT execute %s', fn))
from unnest(array[
  'public.request_instance_create(uuid, uuid, uuid, text, text, text, text, boolean, text)',
  'public.request_instance_snapshot(uuid, text, text)',
  'public.request_instance_resize(uuid, text, text)',
  'public.request_instance_restore_replace(uuid, uuid, text)',
  'public.request_instance_deletion(uuid, text)',
  'public.reveal_instance_ssh_password(uuid)',
  'public.mark_org_instances_ssh_dirty(uuid)',
  'public.can_provision_instance(text, text, text)',
  'public.accept_invite(text)'
]) as fn;

-- Deliberately anon-callable: these back pages that render before sign-in (the
-- invite landing page, the signed-out catalogue) or are reached by token from a
-- link. Asserted so that "anon can call this" stays a decision, not an accident.
select ok(has_function_privilege('anon', fn, 'execute'), format('anon may execute %s, by design', fn))
from unnest(array[
  'public.get_invite_by_token(text)',
  'public.list_admittable_sites()',
  'public.catalog_image_site_availability()',
  'public.redeem_enrollment_token(text)',
  'public.redeem_instance_enrollment_token(text)'
]) as fn;

-- Vault accessors and worker RPCs: never reachable from a browser session.
select ok(not has_function_privilege(role_name, fn, 'execute'),
          format('%s may NOT execute %s', role_name, fn))
from unnest(array['anon','authenticated']) as role_name,
     unnest(array[
       'public.get_vault_secret(text)',
       'public.set_vault_secret(text, text)',
       'public.current_worker_cluster()',
       'public.worker_claim_next_operation()',
       'public.worker_get_proxmox_credential()'
     ]) as fn;

-- Trigger-only functions. These run as SECURITY DEFINER off a trigger; a direct
-- call from a client role would run privileged code with attacker-chosen input.
select ok(not has_function_privilege(role_name, fn, 'execute'),
          format('%s may NOT execute trigger function %s', role_name, fn))
from unnest(array['anon','authenticated']) as role_name,
     unnest(array[
       'public.handle_new_organization()',
       'public.link_pending_invites()',
       'public.route_operation_by_instance()'
     ]) as fn;

-- touch_instances_updated_at() is the exception: it IS executable by anon and
-- authenticated in production. That is inert rather than intended -- it is
-- SECURITY INVOKER, touches no table, and returns trigger, so Postgres refuses
-- a direct call regardless of the grant. Asserted rather than silently
-- tolerated, so the exception stays visible and stays harmless.
select throws_ok(
  $$select public.touch_instances_updated_at()$$,
  '0A000',
  null,
  'touch_instances_updated_at cannot be called directly despite its grant'
);

-- ---------------------------------------------------------------------------
-- 4. The RLS helpers actually work, under a real role and real JWT claims
--
-- has_function_privilege proves a grant exists. It does not prove the function
-- returns the right answer for the caller, which is what every policy depends
-- on. These run as `authenticated` with the claim PostgREST would set.
-- ---------------------------------------------------------------------------

-- Two organizations, two users, no overlap.
insert into auth.users (id, email) values
  ('20000000-0000-4000-8000-000000000001', 'owner-a@example.test'),
  ('20000000-0000-4000-8000-000000000002', 'owner-b@example.test');

-- Each org is created the way the console creates one: as the signed-in owner,
-- through the INSERT policy, with the JWT claim PostgREST would set. Inserting
-- as postgres instead would fail -- handle_new_organization() calls
-- log_audit_event(), which refuses a caller who is not a member, and with no
-- claim auth.uid() is NULL. That is the trigger chain working correctly, so the
-- test exercises it rather than bypassing it.
set local role authenticated;

set local "request.jwt.claim.sub" = '20000000-0000-4000-8000-000000000001';
insert into public.organizations (id, name, slug, owner_id) values
  ('10000000-0000-4000-8000-00000000000a', 'Org A', 'org-a', '20000000-0000-4000-8000-000000000001');

set local "request.jwt.claim.sub" = '20000000-0000-4000-8000-000000000002';
insert into public.organizations (id, name, slug, owner_id) values
  ('10000000-0000-4000-8000-00000000000b', 'Org B', 'org-b', '20000000-0000-4000-8000-000000000002');

reset role;

select is(
  (select count(*)::int from public.memberships
    where organization_id = '10000000-0000-4000-8000-00000000000a'
      and user_id = '20000000-0000-4000-8000-000000000001'
      and role = 'Owner'),
  1,
  'creating an org makes its owner an Owner member -- without this the creator cannot see their own org'
);

select is(
  (select count(*)::int from public.audit_log
    where organization_id = '10000000-0000-4000-8000-00000000000a' and action = 'org.created'),
  1,
  'org creation writes an audit event through the definer function'
);

set local role authenticated;
set local "request.jwt.claim.sub" = '20000000-0000-4000-8000-000000000001';

select ok(public.is_org_member('10000000-0000-4000-8000-00000000000a'),
  'a member is recognised in their own organization');
select ok(not public.is_org_member('10000000-0000-4000-8000-00000000000b'),
  'a member is NOT recognised in another organization -- cross-org isolation');
select ok(public.has_org_role('10000000-0000-4000-8000-00000000000a', array['Owner']),
  'the owner holds the Owner role');
select ok(not public.has_org_role('10000000-0000-4000-8000-00000000000a', array['Billing']),
  'the owner does not hold a role they were never granted');
select ok(not public.has_org_role('10000000-0000-4000-8000-00000000000b', array['Owner']),
  'the owner of A holds no role in B');

-- The policies themselves, not just the helpers behind them.
select is(
  (select count(*)::int from public.organizations),
  1,
  'RLS shows a signed-in user exactly their own organization'
);

select is(
  (select count(*)::int from public.audit_log),
  1,
  'RLS scopes the audit log to the caller''s organization'
);

select throws_ok(
  format($$select public.log_audit_event(%L, 'forged.event')$$,
         '10000000-0000-4000-8000-00000000000b'),
  null,
  'not a member of this organization',
  'a member of A cannot write an audit event into B'
);

reset role;

-- An unauthenticated caller reaches none of it. The grant is missing, so the
-- call fails outright rather than returning a misleading false.
set local role anon;

select throws_ok(
  format($$select public.is_org_member(%L)$$, '10000000-0000-4000-8000-00000000000a'),
  '42501',
  null,
  'anon cannot call is_org_member at all'
);

-- Not an empty result -- a hard denial. The SELECT policy on organizations calls
-- is_org_member(), and anon has no EXECUTE on it, so the read fails before RLS
-- filters anything. Defence in depth: even a policy mistake would not leak rows
-- to a signed-out caller.
select throws_ok(
  $$select count(*) from public.organizations$$,
  '42501',
  null,
  'anon is denied outright on organizations, not merely filtered to zero rows'
);

select is(
  (select count(*)::int from public.catalog_plans),
  4,
  'anon still reads the catalogue -- the signed-out pricing page depends on it'
);

reset role;

-- ---------------------------------------------------------------------------
-- 5. The catalogue seed survived the chain
--
-- 20260808200400 and 20260811080000 insert catalog_image_site_templates rows
-- with a foreign key onto catalog_images. Without the baseline's seed the whole
-- chain fails on that constraint, so this is a load-bearing row set, not
-- decoration.
-- ---------------------------------------------------------------------------

select ok(
  (select count(*) from public.catalog_images) >= 8,
  'the catalogue seed is present for the template migrations to reference'
);

select ok(
  (select bool_and(is_placeholder) from public.catalog_plans),
  'every plan is still flagged is_placeholder -- master plan section 16 forbids publishing real pricing'
);

select * from finish();
rollback;
