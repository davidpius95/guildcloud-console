-- Extra fixture for the cluster worker boundary contract. Applied on top of
-- instance_intents_base.sql, which supplies organizations/projects/instances/
-- operations/operation_stages/capacity_reservations and the RLS helpers.
--
-- Everything here mirrors a production object the boundary migration depends on
-- but which the intents fixture does not need.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator noinherit;
  end if;
end
$$;

create schema if not exists auth;

-- Mirrors Supabase's own auth.jwt(): the claims JSON that PostgREST puts on the
-- connection. The intents fixture only ever needed `request.jwt.claim.sub`, but
-- the worker boundary reads a non-subject claim, so it needs the real shape.
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

create table public.infrastructure_clusters (
  id text primary key,
  site_id text not null,
  name text not null,
  enabled boolean not null default true,
  admission_state text not null default 'open',
  worker_id text,
  worker_heartbeat_at timestamptz,
  capacity_observed_at timestamptz,
  private_networking_healthy boolean,
  backup_healthy boolean,
  monitoring_healthy boolean,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Stand-ins for the two production primitives the boundary wraps. They record
-- what they were called with so the contract can prove the cluster argument came
-- from the identity lookup rather than from the caller.
create table public.test_primitive_calls (
  id bigserial primary key,
  fn text not null,
  cluster_id text,
  called_at timestamptz not null default now()
);

create or replace function public.place_next_pending_operation(
  p_worker_cluster_id text,
  p_now timestamptz,
  p_force_cluster_id text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_operation_id uuid;
begin
  insert into public.test_primitive_calls (fn, cluster_id)
  values ('place_next_pending_operation', p_worker_cluster_id);

  select operation.id into v_operation_id
  from public.operations as operation
  where operation.state = 'pending' and operation.cluster_id = p_worker_cluster_id
  order by operation.id
  limit 1;

  return v_operation_id;
end
$$;

create or replace function public.publish_cluster_snapshot(
  p_cluster_id text,
  p_snapshot jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.test_primitive_calls (fn, cluster_id)
  values ('publish_cluster_snapshot', p_cluster_id);

  update public.infrastructure_clusters
  set capacity_observed_at = now()
  where id = p_cluster_id;
end
$$;

-- Two real clusters, matching production ids.
insert into public.infrastructure_clusters (id, site_id, name) values
  ('guild-a', 'lag-1', 'Guild A'),
  ('guild-b', 'lag-1', 'Guild B');
