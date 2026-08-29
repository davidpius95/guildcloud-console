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

-- ---------------------------------------------------------------------------
-- Tables slice B reaches. The base fixture predates them.
-- ---------------------------------------------------------------------------

alter table public.memberships add column if not exists device_enrolled boolean not null default false;
alter table public.memberships add column if not exists tailscale_device_id text;

create table public.ssh_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null default '',
  public_key text not null,
  created_at timestamptz not null default now()
);

create table public.access_grants (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.memberships(id),
  project_id uuid not null references public.projects(id),
  resource_type text not null,
  resource_id uuid
);

create table public.warm_pool_vms (
  id uuid primary key default gen_random_uuid(),
  cluster_id text not null,
  site_id text not null,
  catalog_image_id text not null,
  catalog_plan_id text not null,
  proxmox_vmid integer,
  proxmox_node text,
  tailscale_hostname text,
  tailscale_device_id text,
  private_ip text,
  state text not null default 'building',
  claimed_by_instance_id uuid references public.instances(id),
  failure_reason text,
  created_at timestamptz not null default now(),
  warmed_at timestamptz,
  claimed_at timestamptz
);

create table public.catalog_image_cluster_node_templates (
  catalog_image_id text not null,
  cluster_id text not null,
  node text not null,
  source_node text not null,
  proxmox_vmid integer not null,
  storage_id text,
  clone_mode text not null default 'linked',
  enabled boolean not null default true,
  primary key (catalog_image_id, cluster_id, node)
);

insert into public.ssh_keys (organization_id, name, public_key) values
  ('10000000-0000-4000-8000-000000000001', 'alpha-laptop', 'ssh-ed25519 AAAA-alpha alpha@example'),
  ('10000000-0000-4000-8000-000000000002', 'beta-laptop', 'ssh-ed25519 AAAA-beta beta@example');

insert into public.warm_pool_vms
  (id, cluster_id, site_id, catalog_image_id, catalog_plan_id, proxmox_vmid, proxmox_node,
   tailscale_hostname, state, warmed_at)
values
  ('70000000-0000-4000-8000-00000000000a', 'guild-a', 'lag-1', 'ubuntu-2404', 'std-1', 900,
   'nodeA', 'pool-900', 'warm', now()),
  ('70000000-0000-4000-8000-00000000000b', 'guild-b', 'lag-1', 'ubuntu-2404', 'std-1', 901,
   'podB', 'pool-901', 'warm', now());

insert into public.catalog_image_cluster_node_templates
  (catalog_image_id, cluster_id, node, source_node, proxmox_vmid, storage_id, clone_mode)
values
  ('ubuntu-2404', 'guild-a', 'nodeA', 'nodeA', 9000, 'ceph-vm', 'linked'),
  ('ubuntu-2404', 'guild-b', 'podB', 'podB', 9001, 'local-lvm', 'full');
