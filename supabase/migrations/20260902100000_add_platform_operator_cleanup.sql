-- A supported way for platform staff to clean up a tenant's abandoned
-- infrastructure.
--
-- Until now there was none. On 2026-09-02 two abandoned clones belonging to
-- another tenant had to be removed by destroying the guests through the Proxmox
-- API and deleting the control-plane rows by hand with service-role access.
-- That works exactly once and is dangerous as a habit: destroying the guest
-- without also removing the row leaves a `failed` instance naming a vmid that
-- Proxmox will reissue, so a later delete resolves node+vmid and destroys an
-- unrelated customer's server. The safe sequence existed only in an operator's
-- head.
--
-- The fix is not a bigger hammer, it is a smaller one. An operator does not need
-- Proxmox access at all: only the site worker can reach Proxmox, so an operator
-- who can *request* a delete gets the entire hardened teardown for free -- guest
-- destroyed, tailnet device released, rows removed, capacity released, all by
-- the same code path a customer's own delete uses. So this grants the ability to
-- ask, not the ability to destroy.

-- ---------------------------------------------------------------------------
-- Who counts as platform staff
-- ---------------------------------------------------------------------------

create table if not exists public.platform_operators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

comment on table public.platform_operators is
  'Platform staff who may act across organizations. Deliberately has no client-facing policy: rows are added out of band (a migration or the SQL editor), never through the app, so the app can never widen its own authority. Membership is read only through is_platform_operator().';

alter table public.platform_operators enable row level security;

-- No policies. With RLS on and no policy, every client-side read and write is
-- refused; the security definer helpers below are the only way in.

create or replace function public.is_platform_operator()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.platform_operators where user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------

-- An operator is by definition not a member of the tenant they are acting on,
-- so the membership check would reject the very events most worth recording.
-- Widened rather than bypassed: log_audit_event stays the single insert path
-- into audit_log, which is the property the table's comment depends on. The
-- event is written into the *tenant's* log, so the customer can see that
-- platform staff acted on their resource.
create or replace function public.log_audit_event(
  p_organization_id uuid,
  p_action text,
  p_project_id uuid default null,
  p_target_type text default null,
  p_target_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id bigint;
begin
  if not (public.is_org_member(p_organization_id) or public.is_platform_operator()) then
    raise exception 'not a member of this organization';
  end if;

  insert into public.audit_log (organization_id, actor_id, project_id, action, target_type, target_id, metadata)
  values (p_organization_id, auth.uid(), p_project_id, p_action, p_target_type, p_target_id, p_metadata)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- What an operator can see
-- ---------------------------------------------------------------------------

-- Read-only, and deliberately narrow: only instances that are not in a healthy
-- or in-flight state. An operator has no business listing every tenant's running
-- servers, and this is the listing that answers "what has been abandoned".
create or replace function public.operator_list_abandoned_instances()
returns table (
  instance_id uuid,
  name text,
  state text,
  organization_id uuid,
  organization_name text,
  project_name text,
  cluster_id text,
  proxmox_node text,
  proxmox_vmid integer,
  created_at timestamptz,
  age_days integer
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select i.id, i.name, i.state, i.organization_id, o.name, p.name,
         i.cluster_id, i.proxmox_node, i.proxmox_vmid, i.created_at,
         floor(extract(epoch from (now() - i.created_at)) / 86400)::integer
  from public.instances i
  join public.organizations o on o.id = i.organization_id
  left join public.projects p on p.id = i.project_id
  where public.is_platform_operator()
    and i.state in ('failed', 'degraded', 'delete_failed')
  order by i.created_at;
$$;

-- ---------------------------------------------------------------------------
-- What an operator can do
-- ---------------------------------------------------------------------------

-- Unchanged from 20260829110000 except the authorization check and the audit
-- event. An operator reaches the same queue, the same stages and the same
-- worker as the tenant's own delete; nothing here touches infrastructure.
create or replace function public.request_instance_delete(
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
  v_is_operator boolean := public.is_platform_operator();
begin
  select operation.* into v_existing from public.operations as operation
  where operation.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.kind = 'instance.delete'
       and v_existing.instance_id = p_instance_id
       and (v_is_operator or public.has_org_role(v_existing.organization_id, array['Owner', 'Admin'])) then
      return v_existing.id;
    end if;
    raise exception using errcode = '42501', message = 'not authorized';
  end if;

  select instance.* into v_instance from public.instances as instance
  where instance.id = p_instance_id for update;
  if not found
     or not (v_is_operator or public.has_org_role(v_instance.organization_id, array['Owner', 'Admin'])) then
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

  -- Only operator-initiated deletes are recorded here. Auditing ordinary
  -- customer lifecycle intent is a separate, wider piece of work; acting across
  -- a tenant boundary is the case that must never be silent.
  if v_is_operator and not public.is_org_member(v_instance.organization_id) then
    perform public.log_audit_event(
      v_instance.organization_id,
      'instance.delete.operator',
      v_instance.project_id,
      'instance',
      v_instance.id::text,
      jsonb_build_object(
        'name', v_instance.name,
        'state_before', v_instance.state,
        'cluster_id', v_instance.cluster_id,
        'proxmox_node', v_instance.proxmox_node,
        'proxmox_vmid', v_instance.proxmox_vmid,
        'reason', 'operator cleanup of abandoned infrastructure'
      )
    );
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

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke execute on function public.is_platform_operator() from public, anon;
grant execute on function public.is_platform_operator() to authenticated;

revoke execute on function public.operator_list_abandoned_instances() from public, anon;
grant execute on function public.operator_list_abandoned_instances() to authenticated;

revoke execute on function public.log_audit_event(uuid, text, uuid, text, text, jsonb) from public, anon;
grant execute on function public.log_audit_event(uuid, text, uuid, text, text, jsonb) to authenticated;

revoke execute on function public.request_instance_delete(uuid, text) from public, anon;
grant execute on function public.request_instance_delete(uuid, text) to authenticated;
