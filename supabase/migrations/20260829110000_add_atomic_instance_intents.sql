alter table public.instances
  drop constraint if exists instances_state_check;

alter table public.instances
  add constraint instances_state_check check (state in (
    'provisioning', 'ready', 'degraded', 'stopped', 'failed',
    'snapshotting', 'resizing', 'restoring', 'deleting', 'delete_failed'
  ));

create unique index if not exists operations_one_active_per_instance_idx
  on public.operations (instance_id)
  where instance_id is not null and state in ('pending', 'running');

create or replace function public.initialize_operation_stages(p_operation_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.operation_stages (operation_id, stage)
  select p_operation_id, stage
  from unnest(array[
    'preflight',
    'capacity_reservation',
    'operation_created',
    'site_worker_dispatch',
    'proxmox_api_call',
    'template_cloud_init',
    'network_access_attach',
    'backup_monitoring_attach',
    'automated_verification',
    'ready'
  ]::text[]) as stage;
$$;

revoke execute on function public.initialize_operation_stages(uuid) from public, anon, authenticated;

create or replace function public.request_instance_create(
  p_instance_id uuid,
  p_operation_id uuid,
  p_project_id uuid,
  p_site_id text,
  p_name text,
  p_catalog_image_id text,
  p_catalog_plan_id text,
  p_password_ssh_enabled boolean,
  p_idempotency_key text
)
returns table(instance_id uuid, operation_id uuid, replayed boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project public.projects%rowtype;
  v_existing public.operations%rowtype;
begin
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception using errcode = '22023', message = 'idempotency key is required';
  end if;

  select operation.* into v_existing
  from public.operations as operation
  where operation.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.kind <> 'instance.create'
       or not public.has_org_role(v_existing.organization_id, array['Owner', 'Admin']) then
      raise exception using errcode = '42501', message = 'not authorized';
    end if;
    return query select v_existing.instance_id, v_existing.id, true;
    return;
  end if;

  select project.* into v_project
  from public.projects as project
  where project.id = p_project_id
  for share;

  if not found or not public.has_org_role(v_project.organization_id, array['Owner', 'Admin']) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if p_instance_id is null or p_operation_id is null or btrim(p_name) = '' then
    raise exception using errcode = '22023', message = 'instance id, operation id, and name are required';
  end if;
  if not exists (select 1 from public.catalog_images where id = p_catalog_image_id)
     or not exists (select 1 from public.catalog_plans where id = p_catalog_plan_id) then
    raise exception using errcode = '22023', message = 'invalid image or plan';
  end if;

  insert into public.instances (
    id, organization_id, project_id, site_id, name, catalog_image_id,
    catalog_plan_id, state, password_ssh_enabled
  ) values (
    p_instance_id, v_project.organization_id, v_project.id, p_site_id,
    btrim(p_name), p_catalog_image_id, p_catalog_plan_id, 'provisioning',
    coalesce(p_password_ssh_enabled, false)
  );

  insert into public.operations (
    id, organization_id, project_id, instance_id, site_id, kind,
    resource_name, state, idempotency_key, stages
  ) values (
    p_operation_id, v_project.organization_id, v_project.id, p_instance_id,
    p_site_id, 'instance.create', btrim(p_name), 'pending',
    p_idempotency_key, '{}'::jsonb
  );

  perform public.initialize_operation_stages(p_operation_id);

  insert into public.audit_log (
    organization_id, actor_id, project_id, action, target_type, target_id, metadata
  ) values (
    v_project.organization_id,
    nullif(current_setting('request.jwt.claim.sub', true), '')::uuid,
    v_project.id, 'instance.create_requested', 'instance', p_instance_id,
    jsonb_build_object(
      'name', btrim(p_name),
      'catalog_image_id', p_catalog_image_id,
      'catalog_plan_id', p_catalog_plan_id,
      'site_id', p_site_id
    )
  );

  return query select p_instance_id, p_operation_id, false;
end
$$;

create or replace function public.request_instance_snapshot(
  p_instance_id uuid,
  p_name text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_instance public.instances%rowtype;
  v_existing public.operations%rowtype;
  v_snapshot_id uuid := gen_random_uuid();
  v_operation_id uuid := gen_random_uuid();
  v_snapname text := 'snap-' || left(replace(gen_random_uuid()::text, '-', ''), 20);
begin
  select operation.* into v_existing from public.operations as operation
  where operation.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.kind = 'instance.snapshot'
       and v_existing.instance_id = p_instance_id
       and public.has_org_role(v_existing.organization_id, array['Owner', 'Admin']) then
      return v_existing.id;
    end if;
    raise exception using errcode = '42501', message = 'not authorized';
  end if;

  select instance.* into v_instance from public.instances as instance
  where instance.id = p_instance_id for update;
  if not found or not public.has_org_role(v_instance.organization_id, array['Owner', 'Admin']) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if v_instance.state <> 'ready' then
    raise exception using errcode = '55000', message = 'instance is busy';
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    raise exception using errcode = '22023', message = 'snapshot name is required';
  end if;

  update public.instances set state = 'snapshotting' where id = v_instance.id;
  insert into public.instance_snapshots (
    id, organization_id, project_id, instance_id, name, proxmox_snapname, state
  ) values (
    v_snapshot_id, v_instance.organization_id, v_instance.project_id,
    v_instance.id, btrim(p_name), v_snapname, 'creating'
  );
  insert into public.operations (
    id, organization_id, project_id, instance_id, site_id, cluster_id,
    assigned_node, storage_id, kind, resource_name, state, idempotency_key, stages
  ) values (
    v_operation_id, v_instance.organization_id, v_instance.project_id,
    v_instance.id, v_instance.site_id, v_instance.cluster_id,
    v_instance.proxmox_node, v_instance.storage_id, 'instance.snapshot',
    v_instance.name || '/' || btrim(p_name), 'pending', p_idempotency_key,
    jsonb_build_object('snapshot_id', v_snapshot_id, 'proxmox_snapname', v_snapname)
  );
  perform public.initialize_operation_stages(v_operation_id);
  return v_operation_id;
end
$$;

create or replace function public.request_instance_resize(
  p_instance_id uuid,
  p_target_plan_id text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_instance public.instances%rowtype;
  v_existing public.operations%rowtype;
  v_current public.catalog_plans%rowtype;
  v_target public.catalog_plans%rowtype;
  v_operation_id uuid := gen_random_uuid();
begin
  select operation.* into v_existing from public.operations as operation
  where operation.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.kind = 'instance.resize'
       and v_existing.instance_id = p_instance_id
       and public.has_org_role(v_existing.organization_id, array['Owner', 'Admin']) then
      return v_existing.id;
    end if;
    raise exception using errcode = '42501', message = 'not authorized';
  end if;

  select instance.* into v_instance from public.instances as instance
  where instance.id = p_instance_id for update;
  if not found or not public.has_org_role(v_instance.organization_id, array['Owner', 'Admin']) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if v_instance.state <> 'ready' then
    raise exception using errcode = '55000', message = 'instance is busy';
  end if;
  select * into strict v_current from public.catalog_plans where id = v_instance.catalog_plan_id;
  select * into v_target from public.catalog_plans where id = p_target_plan_id;
  if not found then
    raise exception using errcode = '22023', message = 'invalid target plan';
  end if;
  if v_target.id = v_current.id
     or v_target.vcpu < v_current.vcpu
     or v_target.memory_gb < v_current.memory_gb
     or v_target.disk_gb < v_current.disk_gb then
    raise exception using errcode = '22023', message = 'resize target must not reduce cpu, memory, or disk';
  end if;

  update public.instances set state = 'resizing' where id = v_instance.id;
  insert into public.operations (
    id, organization_id, project_id, instance_id, site_id, cluster_id,
    assigned_node, storage_id, kind, resource_name, state, idempotency_key, stages
  ) values (
    v_operation_id, v_instance.organization_id, v_instance.project_id,
    v_instance.id, v_instance.site_id, v_instance.cluster_id,
    v_instance.proxmox_node, v_instance.storage_id, 'instance.resize',
    v_instance.name, 'pending', p_idempotency_key,
    jsonb_build_object(
      'old_plan_id', v_current.id,
      'target_plan_id', v_target.id,
      'old_resources', jsonb_build_object('vcpu', v_current.vcpu, 'memory_gb', v_current.memory_gb, 'disk_gb', v_current.disk_gb),
      'target_resources', jsonb_build_object('vcpu', v_target.vcpu, 'memory_gb', v_target.memory_gb, 'disk_gb', v_target.disk_gb)
    )
  );
  perform public.initialize_operation_stages(v_operation_id);
  return v_operation_id;
end
$$;

create or replace function public.request_instance_restore_replace(
  p_instance_id uuid,
  p_snapshot_id uuid,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_instance public.instances%rowtype;
  v_snapshot public.instance_snapshots%rowtype;
  v_existing public.operations%rowtype;
  v_operation_id uuid := gen_random_uuid();
begin
  select operation.* into v_existing from public.operations as operation
  where operation.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.kind = 'instance.restore_replace'
       and v_existing.instance_id = p_instance_id
       and public.has_org_role(v_existing.organization_id, array['Owner', 'Admin']) then
      return v_existing.id;
    end if;
    raise exception using errcode = '42501', message = 'not authorized';
  end if;

  select instance.* into v_instance from public.instances as instance
  where instance.id = p_instance_id for update;
  if not found or not public.has_org_role(v_instance.organization_id, array['Owner', 'Admin']) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if v_instance.state <> 'ready' then
    raise exception using errcode = '55000', message = 'instance is busy';
  end if;
  select snapshot.* into v_snapshot
  from public.instance_snapshots as snapshot
  where snapshot.id = p_snapshot_id
    and snapshot.instance_id = v_instance.id
    and snapshot.organization_id = v_instance.organization_id
    and snapshot.project_id = v_instance.project_id
    and snapshot.state = 'ready';
  if not found then
    raise exception using errcode = '22023', message = 'snapshot is not a ready recovery point for this instance';
  end if;

  update public.instances set state = 'restoring' where id = v_instance.id;
  insert into public.operations (
    id, organization_id, project_id, instance_id, site_id, cluster_id,
    assigned_node, storage_id, kind, resource_name, state, idempotency_key, stages
  ) values (
    v_operation_id, v_instance.organization_id, v_instance.project_id,
    v_instance.id, v_instance.site_id, v_instance.cluster_id,
    v_instance.proxmox_node, v_instance.storage_id, 'instance.restore_replace',
    v_instance.name, 'pending', p_idempotency_key,
    jsonb_build_object('snapshot_id', v_snapshot.id, 'proxmox_snapname', v_snapshot.proxmox_snapname)
  );
  perform public.initialize_operation_stages(v_operation_id);
  return v_operation_id;
end
$$;

create or replace function public.request_instance_deletion(
  p_instance_id uuid,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_instance public.instances%rowtype;
  v_existing public.operations%rowtype;
  v_operation_id uuid := gen_random_uuid();
begin
  select operation.* into v_existing from public.operations as operation
  where operation.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.kind = 'instance.delete'
       and v_existing.instance_id = p_instance_id
       and public.has_org_role(v_existing.organization_id, array['Owner', 'Admin']) then
      return v_existing.id;
    end if;
    raise exception using errcode = '42501', message = 'not authorized';
  end if;

  select instance.* into v_instance from public.instances as instance
  where instance.id = p_instance_id for update;
  if not found or not public.has_org_role(v_instance.organization_id, array['Owner', 'Admin']) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if v_instance.state = 'deleting' then
    select operation.* into v_existing from public.operations as operation
    where operation.instance_id = v_instance.id
      and operation.kind = 'instance.delete'
      and operation.state in ('pending', 'running')
    order by operation.started_at desc limit 1;
    if found then return v_existing.id; end if;
  end if;
  if v_instance.state not in ('ready', 'stopped', 'failed', 'degraded', 'delete_failed') then
    raise exception using errcode = '55000', message = 'instance is busy';
  end if;

  update public.instances set state = 'deleting' where id = v_instance.id;
  insert into public.operations (
    id, organization_id, project_id, instance_id, site_id, cluster_id,
    assigned_node, storage_id, kind, resource_name, state, idempotency_key, stages
  ) values (
    v_operation_id, v_instance.organization_id, v_instance.project_id,
    v_instance.id, v_instance.site_id, v_instance.cluster_id,
    v_instance.proxmox_node, v_instance.storage_id, 'instance.delete',
    v_instance.name, 'pending', p_idempotency_key, '{}'::jsonb
  );
  perform public.initialize_operation_stages(v_operation_id);
  return v_operation_id;
end
$$;

create or replace function public.finish_instance_operation(
  p_operation_id uuid,
  p_outcome text,
  p_observed jsonb,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_operation public.operations%rowtype;
  v_instance public.instances%rowtype;
  v_snapshot_id uuid;
  v_target_plan public.catalog_plans%rowtype;
begin
  if p_outcome not in ('succeeded', 'failed') then
    raise exception using errcode = '22023', message = 'outcome must be succeeded or failed';
  end if;
  select operation.* into v_operation from public.operations as operation
  where operation.id = p_operation_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'operation not found';
  end if;
  if v_operation.state in ('succeeded', 'failed', 'cancelled') then
    return;
  end if;
  select instance.* into v_instance from public.instances as instance
  where instance.id = v_operation.instance_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'instance not found';
  end if;

  if v_operation.kind = 'instance.snapshot' then
    v_snapshot_id := (v_operation.stages ->> 'snapshot_id')::uuid;
    update public.instance_snapshots
    set state = case when p_outcome = 'succeeded' then 'ready' else 'failed' end
    where id = v_snapshot_id and instance_id = v_instance.id;
    update public.instances set state = 'ready' where id = v_instance.id;
  elsif v_operation.kind = 'instance.resize' then
    if p_outcome = 'succeeded' then
      select * into strict v_target_plan from public.catalog_plans
      where id = v_operation.stages ->> 'target_plan_id';
      if p_observed is null
         or (p_observed ->> 'vcpu')::numeric <> v_target_plan.vcpu
         or (p_observed ->> 'memory_gb')::numeric <> v_target_plan.memory_gb
         or (p_observed ->> 'disk_gb')::numeric < v_target_plan.disk_gb then
        raise exception using errcode = '22023', message = 'observed resources do not match target plan';
      end if;
      update public.instances
      set catalog_plan_id = v_target_plan.id, state = 'ready'
      where id = v_instance.id;
    else
      update public.instances set state = 'degraded' where id = v_instance.id;
    end if;
  elsif v_operation.kind = 'instance.restore_replace' then
    update public.instances
    set state = case when p_outcome = 'succeeded' then 'ready' else 'degraded' end
    where id = v_instance.id;
  elsif v_operation.kind = 'instance.delete' and p_outcome = 'failed' then
    update public.instances set state = 'delete_failed' where id = v_instance.id;
  end if;

  update public.capacity_reservations
  set state = 'released'
  where operation_id = v_operation.id and state = 'held';

  update public.operations
  set state = p_outcome,
      failure_reason = case when p_outcome = 'failed' then p_error else null end,
      ended_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = v_operation.id;

  if v_operation.kind = 'instance.delete' and p_outcome = 'succeeded' then
    delete from public.instances where id = v_instance.id;
  end if;
end
$$;

revoke execute on function public.request_instance_create(uuid, uuid, uuid, text, text, text, text, boolean, text) from public, anon;
revoke execute on function public.request_instance_snapshot(uuid, text, text) from public, anon;
revoke execute on function public.request_instance_resize(uuid, text, text) from public, anon;
revoke execute on function public.request_instance_restore_replace(uuid, uuid, text) from public, anon;
revoke execute on function public.request_instance_deletion(uuid, text) from public, anon;
revoke execute on function public.finish_instance_operation(uuid, text, jsonb, text) from public, anon, authenticated;

grant execute on function public.request_instance_create(uuid, uuid, uuid, text, text, text, text, boolean, text) to authenticated;
grant execute on function public.request_instance_snapshot(uuid, text, text) to authenticated;
grant execute on function public.request_instance_resize(uuid, text, text) to authenticated;
grant execute on function public.request_instance_restore_replace(uuid, uuid, text) to authenticated;
grant execute on function public.request_instance_deletion(uuid, text) to authenticated;
grant execute on function public.finish_instance_operation(uuid, text, jsonb, text) to service_role;
