create extension if not exists pgcrypto;
create extension if not exists pgtap;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

create table public.organizations (
  id uuid primary key,
  name text not null,
  owner_id uuid not null,
  slug text not null unique,
  wallet_balance_cents bigint not null default 0,
  created_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  user_id uuid,
  role text not null,
  created_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  name text not null,
  slug text not null,
  description text not null default '',
  accent text not null default 'lemon',
  tailscale_acl_state text not null default 'pending',
  created_at timestamptz not null default now()
);

create table public.catalog_images (
  id text primary key,
  name text not null,
  version text not null,
  family text not null,
  recommended boolean not null default false,
  available_sites text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.catalog_plans (
  id text primary key,
  name text not null,
  vcpu integer not null,
  memory_gb numeric not null,
  disk_gb numeric not null,
  hourly_price numeric not null,
  monthly_max numeric not null,
  is_placeholder boolean not null default false,
  note text,
  created_at timestamptz not null default now()
);

create table public.instances (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  project_id uuid not null references public.projects(id),
  site_id text not null,
  cluster_id text,
  proxmox_vmid integer,
  proxmox_node text,
  storage_id text,
  name text not null,
  catalog_image_id text not null references public.catalog_images(id),
  catalog_plan_id text not null references public.catalog_plans(id),
  private_ip inet,
  private_hostname text,
  tailscale_device_id text,
  password_ssh_enabled boolean not null default false,
  ssh_keys_sync_pending boolean not null default false,
  state text not null constraint instances_state_check
    check (state in ('provisioning', 'ready', 'degraded', 'stopped', 'failed', 'deleting')),
  created_at timestamptz not null default now()
);

create table public.operations (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  project_id uuid references public.projects(id),
  instance_id uuid references public.instances(id) on delete set null,
  site_id text not null,
  cluster_id text,
  assigned_node text,
  storage_id text,
  kind text not null,
  resource_name text not null,
  state text not null default 'pending'
    check (state in ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  idempotency_key text not null unique,
  stages jsonb not null default '{}',
  current_stage text,
  failure_reason text,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz
);

create table public.operation_stages (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.operations(id) on delete cascade,
  stage text not null,
  status text not null default 'pending',
  attempt integer not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  detail jsonb not null default '{}',
  error text,
  unique (operation_id, stage)
);

create table public.instance_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  project_id uuid not null references public.projects(id),
  instance_id uuid not null references public.instances(id) on delete cascade,
  name text not null,
  proxmox_snapname text not null,
  size_bytes bigint default 0,
  state text not null default 'creating',
  created_at timestamptz not null default now()
);

create table public.capacity_reservations (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.operations(id) on delete cascade,
  state text not null default 'held'
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id),
  actor_id uuid,
  project_id uuid references public.projects(id),
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create or replace function public.is_org_member(p_org_id uuid)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.memberships
    where organization_id = p_org_id
      and user_id = nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  )
$$;

create or replace function public.has_org_role(p_org_id uuid, p_roles text[])
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.memberships
    where organization_id = p_org_id
      and user_id = nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      and role = any(p_roles)
  )
$$;

revoke execute on function public.is_org_member(uuid) from public, anon;
revoke execute on function public.has_org_role(uuid, text[]) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, text[]) to authenticated;

insert into public.organizations (id, name, owner_id, slug) values
  ('10000000-0000-4000-8000-000000000001', 'Alpha', '20000000-0000-4000-8000-000000000001', 'alpha'),
  ('10000000-0000-4000-8000-000000000002', 'Beta', '20000000-0000-4000-8000-000000000002', 'beta');

insert into public.memberships (organization_id, user_id, role) values
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Owner'),
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', 'Developer'),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Owner');

insert into public.projects (id, organization_id, name, slug) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Production', 'production'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Other', 'other');

insert into public.catalog_images (id, name, version, family) values
  ('ubuntu-2404', 'Ubuntu', '24.04 LTS', 'os');

insert into public.catalog_plans (id, name, vcpu, memory_gb, disk_gb, hourly_price, monthly_max) values
  ('std-1', 'Standard 1', 1, 2, 40, 0.016, 11.52),
  ('std-2', 'Standard 2', 2, 4, 80, 0.031, 22.32),
  ('std-down', 'Invalid Downsize', 1, 1, 20, 0.008, 5.76);

insert into public.instances
  (id, organization_id, project_id, site_id, cluster_id, proxmox_vmid,
   proxmox_node, storage_id, name, catalog_image_id, catalog_plan_id, state)
values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
   '30000000-0000-4000-8000-000000000001', 'lag-1', 'guild-a', 101,
   'nodeA', 'local-lvm', 'alpha-ready', 'ubuntu-2404', 'std-1', 'ready'),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002',
   '30000000-0000-4000-8000-000000000002', 'lag-1', 'guild-b', 201,
   'podB', 'local-lvm', 'beta-ready', 'ubuntu-2404', 'std-1', 'ready');

insert into public.instance_snapshots
  (id, organization_id, project_id, instance_id, name, proxmox_snapname, state)
values
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
   '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
   'ready-alpha', 'snap-ready-alpha', 'ready'),
  ('50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
   '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
   'creating-alpha', 'snap-creating-alpha', 'creating'),
  ('50000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002',
   '30000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002',
   'ready-beta', 'snap-ready-beta', 'ready');
