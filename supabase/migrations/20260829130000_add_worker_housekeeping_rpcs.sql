-- Cluster-scoped worker RPC boundary, slice B (plan Task 7).
--
-- Slice A moved the operation execution path behind worker_* RPCs. This moves
-- everything that was left writing to tables directly: deletion reconciliation,
-- SSH-key synchronization, warm-pool maintenance, instance runtime fields,
-- capacity reservations, and Tailscale metadata. Together with slice A this is
-- what actually lets SUPABASE_SERVICE_ROLE_KEY come off the worker boxes.
--
-- One change of kind worth calling out: tailnet housekeeping is genuinely
-- tailnet-wide, not cluster-scoped -- it reconciles one Tailscale ACL for every
-- org. Today the worker asserts that role itself via TAILNET_HOUSEKEEPING_OWNER
-- in its own env file, so two workers that both set it race a read-modify-write
-- of the same policy. It becomes a column on worker_identities instead, so the
-- database decides which single worker holds it, the same way it decides which
-- cluster a worker may touch.

alter table public.worker_identities
  add column if not exists tailnet_housekeeping boolean not null default false;

comment on column public.worker_identities.tailnet_housekeeping is
  'Grants the tailnet-wide housekeeping role (ACL reconciliation, member device '
  'enrollment, instance device tags). Deliberately not derived from the worker''s '
  'own env file: exactly one worker should hold it, and only the control plane '
  'can say which.';

-- At most one live housekeeping worker, enforced rather than documented.
create unique index if not exists worker_identities_single_housekeeper_idx
  on public.worker_identities ((tailnet_housekeeping))
  where tailnet_housekeeping and revoked_at is null;

create or replace function public.assert_worker_tailnet_housekeeper()
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_worker_id text := nullif(btrim(coalesce(auth.jwt() ->> 'worker_id', '')), '');
begin
  -- Resolve the cluster first so an unknown or revoked worker fails identically
  -- here and everywhere else.
  perform public.current_worker_cluster();

  if not exists (
    select 1 from public.worker_identities as identity
    where identity.worker_id = v_worker_id
      and identity.revoked_at is null
      and identity.tailnet_housekeeping
  ) then
    raise exception using errcode = '42501',
      message = 'worker does not hold the tailnet housekeeping role';
  end if;
end
$$;

revoke execute on function public.assert_worker_tailnet_housekeeper() from public, anon, authenticated;
grant execute on function public.assert_worker_tailnet_housekeeper() to guildcloud_site_worker;

-- Instance-level twin of assert_worker_owns_operation. Same "report as missing,
-- not forbidden" behaviour so a worker cannot probe for another cluster's ids.
create or replace function public.assert_worker_owns_instance(p_instance_id uuid)
returns public.instances
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_instance public.instances%rowtype;
begin
  select instance.* into v_instance
  from public.instances as instance
  where instance.id = p_instance_id
    and instance.cluster_id = public.current_worker_cluster();

  if not found then
    raise exception using errcode = 'P0002', message = 'instance not found for this cluster';
  end if;

  return v_instance;
end
$$;

revoke execute on function public.assert_worker_owns_instance(uuid) from public, anon, authenticated;
grant execute on function public.assert_worker_owns_instance(uuid) to guildcloud_site_worker;

-- ---------------------------------------------------------------------------
-- Instance runtime fields
-- ---------------------------------------------------------------------------

-- One narrow write path for the handful of columns the worker legitimately
-- observes from infrastructure. The whitelist is the point: the worker learns a
-- VMID or a Tailscale address and records it, but cannot reach catalog_plan_id,
-- organization_id, or anything else that would let it re-bill or re-tenant an
-- instance. Unknown keys are rejected rather than ignored, so a typo fails
-- loudly instead of silently not persisting.
create or replace function public.worker_update_instance_runtime(
  p_instance_id uuid,
  p_patch jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_instance public.instances%rowtype;
  v_key text;
  v_allowed constant text[] := array[
    'proxmox_vmid', 'proxmox_node', 'storage_id', 'private_ip',
    'private_hostname', 'tailscale_device_id', 'ssh_keys_sync_pending'
  ];
begin
  v_instance := public.assert_worker_owns_instance(p_instance_id);

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception using errcode = '22023', message = 'patch must be a JSON object';
  end if;

  for v_key in select jsonb_object_keys(p_patch) loop
    if not (v_key = any(v_allowed)) then
      raise exception using errcode = '42501',
        message = format('column %L is not worker-writable', v_key);
    end if;
  end loop;

  update public.instances
  set proxmox_vmid = coalesce((p_patch ->> 'proxmox_vmid')::integer, proxmox_vmid),
      proxmox_node = coalesce(p_patch ->> 'proxmox_node', proxmox_node),
      storage_id = coalesce(p_patch ->> 'storage_id', storage_id),
      private_ip = coalesce((p_patch ->> 'private_ip')::inet, private_ip),
      private_hostname = coalesce(p_patch ->> 'private_hostname', private_hostname),
      tailscale_device_id = coalesce(p_patch ->> 'tailscale_device_id', tailscale_device_id),
      ssh_keys_sync_pending = coalesce((p_patch ->> 'ssh_keys_sync_pending')::boolean, ssh_keys_sync_pending)
  where id = v_instance.id;
end
$$;

-- ---------------------------------------------------------------------------
-- Deletion reconciliation
-- ---------------------------------------------------------------------------

-- Returns this cluster's instances awaiting teardown, each already paired with
-- its active delete operation, so the worker no longer scans every instance in
-- state='deleting' across both clusters and filters in JavaScript.
--
-- Instances that failed before placement have no cluster_id and so belong to no
-- worker. They are returned only to the tailnet housekeeper, which is the one
-- worker with a tailnet-wide remit -- otherwise both workers would race to
-- finalize the same orphan.
create or replace function public.worker_list_pending_deletions()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_cluster_id text := public.current_worker_cluster();
  v_is_housekeeper boolean;
begin
  select exists (
    select 1 from public.worker_identities as identity
    where identity.worker_id = auth.jwt() ->> 'worker_id'
      and identity.revoked_at is null
      and identity.tailnet_housekeeping
  ) into v_is_housekeeper;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', instance.id,
      'cluster_id', instance.cluster_id,
      'proxmox_vmid', instance.proxmox_vmid,
      'proxmox_node', instance.proxmox_node,
      'tailscale_device_id', instance.tailscale_device_id,
      'operation_id', operation.id
    ))
    from public.instances as instance
    join public.operations as operation
      on operation.instance_id = instance.id
     and operation.kind = 'instance.delete'
     and operation.state in ('pending', 'running')
    where instance.state = 'deleting'
      and (
        instance.cluster_id = v_cluster_id
        or (instance.cluster_id is null and v_is_housekeeper)
        or (instance.proxmox_vmid is null and v_is_housekeeper)
      )
  ), '[]'::jsonb);
end
$$;

-- ---------------------------------------------------------------------------
-- SSH key synchronization
-- ---------------------------------------------------------------------------

-- Returns this cluster's instances needing a key push, with the organization's
-- current public keys already joined. Public keys only: the worker has never
-- needed, and now cannot read, anything else on ssh_keys.
create or replace function public.worker_list_pending_ssh_key_syncs()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_cluster_id text := public.current_worker_cluster();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', instance.id,
      'organization_id', instance.organization_id,
      'cluster_id', instance.cluster_id,
      'proxmox_vmid', instance.proxmox_vmid,
      'proxmox_node', instance.proxmox_node,
      'public_keys', coalesce((
        select jsonb_agg(key.public_key order by key.public_key)
        from public.ssh_keys as key
        where key.organization_id = instance.organization_id
      ), '[]'::jsonb)
    ))
    from public.instances as instance
    where instance.ssh_keys_sync_pending
      and instance.state = 'ready'
      and instance.cluster_id = v_cluster_id
  ), '[]'::jsonb);
end
$$;

-- ---------------------------------------------------------------------------
-- Capacity reservations
-- ---------------------------------------------------------------------------

create or replace function public.worker_hold_capacity(
  p_operation_id uuid,
  p_node text,
  p_vcpu integer,
  p_memory_gb numeric,
  p_disk_gb numeric,
  p_storage_id text,
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_operation public.operations%rowtype;
  v_reservation_id uuid := gen_random_uuid();
begin
  v_operation := public.assert_worker_owns_operation(p_operation_id);

  insert into public.capacity_reservations
    (id, operation_id, cluster_id, site_id, node, vcpu, memory_gb, disk_gb, storage_id, state, expires_at)
  values
    (v_reservation_id, v_operation.id, v_operation.cluster_id, v_operation.site_id, p_node,
     p_vcpu, p_memory_gb, p_disk_gb, p_storage_id, 'held',
     -- Null keeps the table's own 15-minute hold window rather than inventing a
     -- second, divergent default here.
     coalesce(p_expires_at, now() + interval '15 minutes'));

  return v_reservation_id;
end
$$;

create or replace function public.worker_release_capacity(p_operation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_operation public.operations%rowtype;
begin
  v_operation := public.assert_worker_owns_operation(p_operation_id);

  update public.capacity_reservations
  set state = 'released'
  where operation_id = v_operation.id and state = 'held';
end
$$;

create or replace function public.worker_list_held_capacity(p_node text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_cluster_id text := public.current_worker_cluster();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('memory_gb', reservation.memory_gb))
    from public.capacity_reservations as reservation
    where reservation.cluster_id = v_cluster_id
      and reservation.node = p_node
      and reservation.state = 'held'
      and reservation.expires_at > now()
  ), '[]'::jsonb);
end
$$;

-- ---------------------------------------------------------------------------
-- Warm pool
-- ---------------------------------------------------------------------------

create or replace function public.worker_list_warm_pool_vms(p_states text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_cluster_id text := public.current_worker_cluster();
begin
  return coalesce((
    select jsonb_agg(to_jsonb(vm))
    from public.warm_pool_vms as vm
    where vm.cluster_id = v_cluster_id
      and vm.state = any(p_states)
  ), '[]'::jsonb);
end
$$;

-- Claims one warm VM for an instance, or returns null so the caller provisions
-- cold. The UPDATE re-checks state = 'warm' inside the statement, so two workers
-- (or two operations in one cycle) can never hand the same pooled VM to two
-- customers: the loser matches no row.
create or replace function public.worker_claim_warm_pool_vm(
  p_instance_id uuid,
  p_catalog_image_id text,
  p_catalog_plan_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cluster_id text := public.current_worker_cluster();
  v_instance public.instances%rowtype;
  v_claimed public.warm_pool_vms%rowtype;
begin
  v_instance := public.assert_worker_owns_instance(p_instance_id);

  update public.warm_pool_vms as vm
  set state = 'claimed',
      claimed_by_instance_id = v_instance.id,
      claimed_at = now()
  where vm.id = (
    select candidate.id
    from public.warm_pool_vms as candidate
    where candidate.state = 'warm'
      and candidate.cluster_id = v_cluster_id
      and candidate.catalog_image_id = p_catalog_image_id
      and candidate.catalog_plan_id = p_catalog_plan_id
    order by candidate.warmed_at nulls last
    for update skip locked
    limit 1
  )
  and vm.state = 'warm'
  returning vm.* into v_claimed;

  if not found then
    return null;
  end if;

  return to_jsonb(v_claimed);
end
$$;

create or replace function public.worker_record_warm_pool_vm(
  p_catalog_image_id text,
  p_catalog_plan_id text,
  p_proxmox_vmid integer,
  p_proxmox_node text,
  p_tailscale_hostname text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cluster_id text := public.current_worker_cluster();
  v_site_id text;
  v_id uuid := gen_random_uuid();
begin
  select cluster.site_id into v_site_id
  from public.infrastructure_clusters as cluster
  where cluster.id = v_cluster_id;

  insert into public.warm_pool_vms
    (id, cluster_id, site_id, catalog_image_id, catalog_plan_id,
     proxmox_vmid, proxmox_node, tailscale_hostname, state)
  values
    (v_id, v_cluster_id, v_site_id, p_catalog_image_id, p_catalog_plan_id,
     p_proxmox_vmid, p_proxmox_node, p_tailscale_hostname, 'building');

  return v_id;
end
$$;

create or replace function public.worker_update_warm_pool_vm(
  p_warm_pool_vm_id uuid,
  p_state text,
  p_tailscale_device_id text default null,
  p_private_ip text default null,
  p_failure_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cluster_id text := public.current_worker_cluster();
begin
  if p_state not in ('building', 'warm', 'claimed', 'failed') then
    raise exception using errcode = '22023', message = 'unknown warm pool state';
  end if;

  update public.warm_pool_vms
  set state = p_state,
      warmed_at = case when p_state = 'warm' then coalesce(warmed_at, now()) else warmed_at end,
      tailscale_device_id = coalesce(p_tailscale_device_id, tailscale_device_id),
      private_ip = coalesce(p_private_ip, private_ip),
      failure_reason = case when p_state = 'failed' then p_failure_reason else failure_reason end
  where id = p_warm_pool_vm_id and cluster_id = v_cluster_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'warm pool vm not found for this cluster';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Catalog and template reads
-- ---------------------------------------------------------------------------

create or replace function public.worker_get_plan(p_catalog_plan_id text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when public.current_worker_cluster() is null then null
    else (select to_jsonb(plan) from public.catalog_plans as plan where plan.id = p_catalog_plan_id)
  end
$$;

create or replace function public.worker_list_node_templates(
  p_catalog_image_id text,
  p_node text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_cluster_id text := public.current_worker_cluster();
begin
  return coalesce((
    select jsonb_agg(to_jsonb(template))
    from public.catalog_image_cluster_node_templates as template
    where template.catalog_image_id = p_catalog_image_id
      and template.cluster_id = v_cluster_id
      and template.node = p_node
  ), '[]'::jsonb);
end
$$;

-- ---------------------------------------------------------------------------
-- Tailnet housekeeping (tailnet-wide, single holder)
-- ---------------------------------------------------------------------------

create or replace function public.worker_get_tailnet_desired_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_worker_tailnet_housekeeper();

  return jsonb_build_object(
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', project.id, 'organization_id', project.organization_id,
        'slug', project.slug, 'tailscale_acl_state', project.tailscale_acl_state))
      from public.projects as project), '[]'::jsonb),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', membership.id, 'organization_id', membership.organization_id,
        'role', membership.role, 'device_enrolled', membership.device_enrolled,
        'user_id', membership.user_id))
      from public.memberships as membership), '[]'::jsonb),
    'instances', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', instance.id, 'organization_id', instance.organization_id,
        'project_id', instance.project_id,
        'tailscale_device_id', instance.tailscale_device_id))
      from public.instances as instance), '[]'::jsonb),
    'access_grants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'membership_id', grant_row.membership_id, 'project_id', grant_row.project_id,
        'resource_type', grant_row.resource_type, 'resource_id', grant_row.resource_id))
      from public.access_grants as grant_row), '[]'::jsonb)
  );
end
$$;

create or replace function public.worker_mark_project_acl_applied(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_worker_tailnet_housekeeper();

  update public.projects set tailscale_acl_state = 'applied' where id = p_project_id;
end
$$;

create or replace function public.worker_mark_member_enrolled(
  p_membership_id uuid,
  p_tailscale_device_id text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_worker_tailnet_housekeeper();

  update public.memberships
  set device_enrolled = true,
      tailscale_device_id = p_tailscale_device_id
  where id = p_membership_id;
end
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

do $$
declare
  v_signature text;
  v_worker_functions constant text[] := array[
    'public.worker_update_instance_runtime(uuid, jsonb)',
    'public.worker_list_pending_deletions()',
    'public.worker_list_pending_ssh_key_syncs()',
    'public.worker_hold_capacity(uuid, text, integer, numeric, numeric, text, timestamptz)',
    'public.worker_release_capacity(uuid)',
    'public.worker_list_held_capacity(text)',
    'public.worker_list_warm_pool_vms(text[])',
    'public.worker_claim_warm_pool_vm(uuid, text, text)',
    'public.worker_record_warm_pool_vm(text, text, integer, text, text)',
    'public.worker_update_warm_pool_vm(uuid, text, text, text, text)',
    'public.worker_get_plan(text)',
    'public.worker_list_node_templates(text, text)',
    'public.worker_get_tailnet_desired_state()',
    'public.worker_mark_project_acl_applied(uuid)',
    'public.worker_mark_member_enrolled(uuid, text)'
  ];
begin
  foreach v_signature in array v_worker_functions loop
    -- PUBLIC first: Postgres grants EXECUTE to PUBLIC on every new function and
    -- roles inherit it, so revoking from the role alone leaves it callable.
    execute format('revoke execute on function %s from public, anon, authenticated', v_signature);
    execute format('grant execute on function %s to guildcloud_site_worker', v_signature);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Create completion
-- ---------------------------------------------------------------------------

-- finish_instance_operation (Task 4) applies outcome-specific state for
-- snapshot, resize, restore, and delete, but not for instance.create -- the
-- worker had been setting instances.state directly for that one kind. `state`
-- is deliberately not worker-writable, so the transition belongs here, in one
-- transaction with the operation's own terminal write.
create or replace function public.worker_finish_operation(
  p_operation_id uuid,
  p_outcome text,
  p_observed jsonb default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_operation public.operations%rowtype;
begin
  v_operation := public.assert_worker_owns_operation(p_operation_id);

  if v_operation.kind = 'instance.create' and v_operation.instance_id is not null then
    update public.instances
    set state = case when p_outcome = 'succeeded' then 'ready' else 'failed' end
    where id = v_operation.instance_id
      and state not in ('deleting', 'delete_failed');
  end if;

  perform public.finish_instance_operation(p_operation_id, p_outcome, p_observed, p_error);
end
$$;

revoke execute on function public.worker_finish_operation(uuid, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.worker_finish_operation(uuid, text, jsonb, text)
  to guildcloud_site_worker;

-- ---------------------------------------------------------------------------
-- Stage vocabulary correction
-- ---------------------------------------------------------------------------

-- Slice A used 'running'/'succeeded' for stage status. The rest of the system
-- has always used 'pending' -> 'active' -> 'done' | 'failed' | 'skipped'
-- (confirmed against production operation_stages), so those RPCs would have
-- rejected or mis-recorded every real stage transition. Corrected here rather
-- than by editing the applied slice A migration.
create or replace function public.worker_start_stage(
  p_operation_id uuid,
  p_stage text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_operation public.operations%rowtype;
begin
  v_operation := public.assert_worker_owns_operation(p_operation_id);

  update public.operation_stages
  set status = 'active',
      attempt = attempt + 1,
      started_at = coalesce(started_at, now())
  where operation_id = v_operation.id and stage = p_stage;

  if not found then
    raise exception using errcode = 'P0002', message = 'stage not found for operation';
  end if;

  update public.operations
  set state = 'running', current_stage = p_stage, updated_at = now()
  where id = v_operation.id;
end
$$;

create or replace function public.worker_complete_stage(
  p_operation_id uuid,
  p_stage text,
  p_status text,
  p_detail jsonb default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_operation public.operations%rowtype;
begin
  -- 'active' is accepted so a stage can record progress and stay in-flight,
  -- which is how the retry/wait paths report what they are waiting on.
  if p_status not in ('active', 'done', 'failed', 'skipped') then
    raise exception using errcode = '22023',
      message = 'stage status must be active, done, failed, or skipped';
  end if;

  v_operation := public.assert_worker_owns_operation(p_operation_id);

  update public.operation_stages
  set status = p_status,
      finished_at = case when p_status in ('done', 'failed', 'skipped') then now() else finished_at end,
      detail = coalesce(p_detail, detail),
      error = case when p_status = 'failed' then p_error else null end
  where operation_id = v_operation.id and stage = p_stage;

  if not found then
    raise exception using errcode = 'P0002', message = 'stage not found for operation';
  end if;

  update public.operations set updated_at = now() where id = v_operation.id;
end
$$;

revoke execute on function public.worker_start_stage(uuid, text) from public, anon, authenticated;
revoke execute on function public.worker_complete_stage(uuid, text, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.worker_start_stage(uuid, text) to guildcloud_site_worker;
grant execute on function public.worker_complete_stage(uuid, text, text, jsonb, text)
  to guildcloud_site_worker;

-- ---------------------------------------------------------------------------
-- Scoped reads
-- ---------------------------------------------------------------------------

-- The worker re-reads an instance at several points in a stage. Reads are
-- cluster-scoped for the same reason writes are: an unscoped read is how a
-- worker learns another cluster's VMID and then acts on it against its own
-- Proxmox, which is the cross-cluster deletion class of bug.
create or replace function public.worker_get_instance(p_instance_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  return to_jsonb(public.assert_worker_owns_instance(p_instance_id));
end
$$;

-- Keyed by instance rather than by organization: the worker has no legitimate
-- way to name an organization it is not currently working for.
create or replace function public.worker_list_instance_ssh_keys(p_instance_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_instance public.instances%rowtype;
begin
  v_instance := public.assert_worker_owns_instance(p_instance_id);

  return coalesce((
    select jsonb_agg(key.public_key order by key.public_key)
    from public.ssh_keys as key
    where key.organization_id = v_instance.organization_id
  ), '[]'::jsonb);
end
$$;

-- Same reasoning: reachable only through an instance this worker owns, so a
-- worker cannot enumerate another tenant's projects.
create or replace function public.worker_get_instance_project(p_instance_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_instance public.instances%rowtype;
begin
  v_instance := public.assert_worker_owns_instance(p_instance_id);

  return (
    select jsonb_build_object(
      'id', project.id, 'slug', project.slug,
      'tailscale_acl_state', project.tailscale_acl_state)
    from public.projects as project
    where project.id = v_instance.project_id
  );
end
$$;

do $$
declare
  v_signature text;
  v_functions constant text[] := array[
    'public.worker_get_instance(uuid)',
    'public.worker_list_instance_ssh_keys(uuid)',
    'public.worker_get_instance_project(uuid)'
  ];
begin
  foreach v_signature in array v_functions loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_signature);
    execute format('grant execute on function %s to guildcloud_site_worker', v_signature);
  end loop;
end
$$;
