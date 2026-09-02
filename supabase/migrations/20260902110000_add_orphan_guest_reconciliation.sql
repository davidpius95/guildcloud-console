-- Detect infrastructure the control plane has never heard of.
--
-- The operator cleanup path added in 20260902100000 can only act on instances
-- the control plane knows about. It has nothing to say about a guest that
-- exists on a node with no instance row at all -- which is what `iiiuuu` (119)
-- and `coolify` (121) were on podF. Nothing in the platform knew they existed;
-- they were found by a human reading a guest list. That is not a detection
-- mechanism.
--
-- The sweep runs on the worker, because only the worker can see Proxmox, and
-- reports findings here. Two properties matter:
--
--   * It reports; it never reaps on its own. A false positive that deletes a
--     guest is unrecoverable, and the population it scans includes the
--     platform's own templates and worker. An operator approves each one.
--   * Membership of the cluster's PVE pool is the boundary, not a tag. Guild-B's
--     nodes carry plenty of non-GuildCloud workloads, and at least one of them
--     (`wazuh`, vmid 130) carries the `guildcloud` tag while belonging to no
--     pool. Matching on tags would have proposed reaping it.

create table if not exists public.infrastructure_findings (
  id uuid primary key default gen_random_uuid(),
  cluster_id text not null,
  kind text not null check (kind in ('orphan_guest')),
  proxmox_node text not null,
  proxmox_vmid integer not null,
  guest_name text,
  guest_status text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  observations integer not null default 1,
  resolved_at timestamptz,
  dismissed_at timestamptz,
  dismissed_by uuid references auth.users(id),
  dismissed_note text,
  approved_for_reap_at timestamptz,
  approved_by uuid references auth.users(id),
  reaped_at timestamptz,
  unique (cluster_id, proxmox_vmid)
);

comment on table public.infrastructure_findings is
  'Guests a cluster worker found in its PVE pool that the control plane cannot account for. Reported by the worker, triaged by a platform operator. No client-facing policy: reachable only through the worker_* and operator_* functions below.';

alter table public.infrastructure_findings enable row level security;

-- ---------------------------------------------------------------------------
-- Worker side
-- ---------------------------------------------------------------------------

-- Everything the control plane knows is legitimately running on this cluster.
-- Warm-pool VMs are included deliberately: they are real guests with no
-- instance row, so a sweep that only consulted `instances` would propose
-- reaping the warm pool on every pass.
create or replace function public.worker_list_known_vmids()
returns integer[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(distinct vmid), array[]::integer[])
  from (
    select i.proxmox_vmid as vmid
    from public.instances i
    where i.cluster_id = public.current_worker_cluster()
      and i.proxmox_vmid is not null
    union
    select w.proxmox_vmid
    from public.warm_pool_vms w
    where w.cluster_id = public.current_worker_cluster()
      and w.proxmox_vmid is not null
  ) known
  where public.current_worker_cluster() is not null;
$$;

-- Upsert this sweep's findings and close out anything that has since gone away.
-- A finding is only ever *observed* here; nothing in this function destroys
-- anything or marks anything approved.
create or replace function public.worker_report_orphan_guests(p_guests jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cluster text := public.current_worker_cluster();
  v_seen integer[] := array[]::integer[];
  v_guest jsonb;
begin
  if v_cluster is null then
    raise exception using errcode = '42501', message = 'not a worker';
  end if;
  if p_guests is null or jsonb_typeof(p_guests) <> 'array' then
    raise exception using errcode = '22023', message = 'guests must be a JSON array';
  end if;

  for v_guest in select * from jsonb_array_elements(p_guests) loop
    v_seen := v_seen || ((v_guest ->> 'vmid')::integer);

    insert into public.infrastructure_findings as f (
      cluster_id, kind, proxmox_node, proxmox_vmid, guest_name, guest_status
    ) values (
      v_cluster, 'orphan_guest', v_guest ->> 'node', (v_guest ->> 'vmid')::integer,
      v_guest ->> 'name', v_guest ->> 'status'
    )
    on conflict (cluster_id, proxmox_vmid) do update
      set last_seen_at = now(),
          -- Counted so an operator can tell a guest that has persisted across
          -- sweeps from one seen once, mid-provision.
          observations = f.observations + 1,
          proxmox_node = excluded.proxmox_node,
          guest_name = excluded.guest_name,
          guest_status = excluded.guest_status,
          resolved_at = null;
  end loop;

  -- Anything previously reported by this cluster that no longer appears has
  -- either been removed or has become a known instance. Either way it is no
  -- longer a finding, and it must not stay on an operator's list.
  update public.infrastructure_findings
  set resolved_at = now()
  where cluster_id = v_cluster
    and resolved_at is null
    and reaped_at is null
    and not (proxmox_vmid = any(v_seen));

  return coalesce(array_length(v_seen, 1), 0);
end
$$;

-- What the worker is allowed to destroy: only findings an operator approved,
-- and only on its own cluster.
create or replace function public.worker_list_approved_reaps()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', f.id, 'node', f.proxmox_node, 'vmid', f.proxmox_vmid, 'name', f.guest_name
  )), '[]'::jsonb)
  from public.infrastructure_findings f
  where f.cluster_id = public.current_worker_cluster()
    and public.current_worker_cluster() is not null
    and f.approved_for_reap_at is not null
    and f.reaped_at is null
    and f.dismissed_at is null;
$$;

create or replace function public.worker_mark_orphan_reaped(p_finding_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cluster text := public.current_worker_cluster();
begin
  if v_cluster is null then
    raise exception using errcode = '42501', message = 'not a worker';
  end if;
  update public.infrastructure_findings
  set reaped_at = now(), resolved_at = now()
  where id = p_finding_id
    and cluster_id = v_cluster
    and approved_for_reap_at is not null;
  if not found then
    raise exception using errcode = '42501', message = 'finding is not approved for this cluster';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Operator side
-- ---------------------------------------------------------------------------

create or replace function public.operator_list_orphan_guests()
returns table (
  finding_id uuid,
  cluster_id text,
  proxmox_node text,
  proxmox_vmid integer,
  guest_name text,
  guest_status text,
  observations integer,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  approved boolean
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select f.id, f.cluster_id, f.proxmox_node, f.proxmox_vmid, f.guest_name,
         f.guest_status, f.observations, f.first_seen_at, f.last_seen_at,
         f.approved_for_reap_at is not null
  from public.infrastructure_findings f
  where public.is_platform_operator()
    and f.resolved_at is null
    and f.dismissed_at is null
    and f.reaped_at is null
  order by f.first_seen_at;
$$;

-- Marks a finding as understood and expected. The row is kept rather than
-- deleted so the next sweep does not re-raise it as though it were new.
create or replace function public.operator_dismiss_orphan_guest(
  p_finding_id uuid,
  p_note text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_platform_operator() then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if btrim(coalesce(p_note, '')) = '' then
    raise exception using errcode = '22023', message = 'a note is required when dismissing a finding';
  end if;
  update public.infrastructure_findings
  set dismissed_at = now(), dismissed_by = auth.uid(), dismissed_note = btrim(p_note)
  where id = p_finding_id and reaped_at is null;
  if not found then
    raise exception using errcode = '22023', message = 'finding not found';
  end if;
end
$$;

-- Approving does not destroy anything: it authorises the cluster's own worker
-- to do so on its next cycle.
create or replace function public.operator_approve_orphan_reap(p_finding_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_finding public.infrastructure_findings%rowtype;
begin
  if not public.is_platform_operator() then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  select * into v_finding from public.infrastructure_findings where id = p_finding_id;
  if not found then
    raise exception using errcode = '22023', message = 'finding not found';
  end if;
  if v_finding.dismissed_at is not null or v_finding.reaped_at is not null then
    raise exception using errcode = '22023', message = 'finding is already closed';
  end if;
  -- A guest seen in only one sweep may simply have been mid-provision when the
  -- sweep ran. Requiring it to persist is the cheapest guard against reaping
  -- something that was about to become a legitimate instance.
  if v_finding.observations < 2 then
    raise exception using errcode = '22023',
      message = 'finding has been observed only once; wait for another sweep to confirm it persists';
  end if;

  update public.infrastructure_findings
  set approved_for_reap_at = now(), approved_by = auth.uid()
  where id = p_finding_id;
end
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke execute on function public.worker_list_known_vmids() from public, anon, authenticated;
revoke execute on function public.worker_report_orphan_guests(jsonb) from public, anon, authenticated;
revoke execute on function public.worker_list_approved_reaps() from public, anon, authenticated;
revoke execute on function public.worker_mark_orphan_reaped(uuid) from public, anon, authenticated;
grant execute on function public.worker_list_known_vmids() to guildcloud_site_worker;
grant execute on function public.worker_report_orphan_guests(jsonb) to guildcloud_site_worker;
grant execute on function public.worker_list_approved_reaps() to guildcloud_site_worker;
grant execute on function public.worker_mark_orphan_reaped(uuid) to guildcloud_site_worker;

revoke execute on function public.operator_list_orphan_guests() from public, anon;
revoke execute on function public.operator_dismiss_orphan_guest(uuid, text) from public, anon;
revoke execute on function public.operator_approve_orphan_reap(uuid) from public, anon;
grant execute on function public.operator_list_orphan_guests() to authenticated;
grant execute on function public.operator_dismiss_orphan_guest(uuid, text) to authenticated;
grant execute on function public.operator_approve_orphan_reap(uuid) to authenticated;
