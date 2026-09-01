-- Let a degraded instance be recovered instead of only deleted.
--
-- Found by testing resize end to end on 2026-09-01: the resize applied the
-- Proxmox config (vcpu, memory and disk) and then failed to restart the VM
-- because the qemu-server lock was still held by the preceding disk grow. The
-- operation failed, finish_instance_operation set the instance to 'degraded',
-- and request_instance_resize / _snapshot / _restore_replace all required
-- state = 'ready' exactly. Every recovery route therefore returned
-- 'instance is busy' and the only remaining action was to destroy the server.
--
-- The restart itself is fixed in the worker (it now waits for the lock rather
-- than racing it). This closes the second half: a failure must not be a
-- one-way door. Bodies are otherwise unchanged from
-- 20260829110000_add_atomic_instance_intents.sql.

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
  -- 'degraded' is admitted deliberately. A resize whose restart failed left
  -- the instance there with the Proxmox config already applied, and because
  -- every request RPC demanded 'ready' exactly, the customer could no longer
  -- resize, snapshot or restore it -- deletion was the only way out of a
  -- half-applied change. Re-requesting is how a degraded instance is driven
  -- back to ready; operations_one_active_per_instance_idx still guarantees
  -- only one runs at a time.
  if v_instance.state not in ('ready', 'degraded') then
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
  -- 'degraded' is admitted deliberately. A resize whose restart failed left
  -- the instance there with the Proxmox config already applied, and because
  -- every request RPC demanded 'ready' exactly, the customer could no longer
  -- resize, snapshot or restore it -- deletion was the only way out of a
  -- half-applied change. Re-requesting is how a degraded instance is driven
  -- back to ready; operations_one_active_per_instance_idx still guarantees
  -- only one runs at a time.
  if v_instance.state not in ('ready', 'degraded') then
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
  -- 'degraded' is admitted deliberately. A resize whose restart failed left
  -- the instance there with the Proxmox config already applied, and because
  -- every request RPC demanded 'ready' exactly, the customer could no longer
  -- resize, snapshot or restore it -- deletion was the only way out of a
  -- half-applied change. Re-requesting is how a degraded instance is driven
  -- back to ready; operations_one_active_per_instance_idx still guarantees
  -- only one runs at a time.
  if v_instance.state not in ('ready', 'degraded') then
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

-- Unchanged from the original definitions, restated because CREATE OR REPLACE
-- does not re-apply them and the default PUBLIC grant returns on replace.
revoke execute on function public.request_instance_snapshot(uuid, text, text) from public, anon;
revoke execute on function public.request_instance_resize(uuid, text, text) from public, anon;
revoke execute on function public.request_instance_restore_replace(uuid, uuid, text) from public, anon;
grant execute on function public.request_instance_snapshot(uuid, text, text) to authenticated;
grant execute on function public.request_instance_resize(uuid, text, text) to authenticated;
grant execute on function public.request_instance_restore_replace(uuid, uuid, text) to authenticated;
