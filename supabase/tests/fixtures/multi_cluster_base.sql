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

grant usage on schema public to anon, authenticated, service_role;

create table public.catalog_images (
  id text primary key
);

create table public.operations (
  id uuid primary key default gen_random_uuid(),
  site_id text not null default 'lag-1',
  state text not null default 'pending'
);

create table public.instances (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  proxmox_vmid integer,
  proxmox_node text,
  constraint instances_proxmox_vmid_key unique (proxmox_vmid)
);

create table public.capacity_reservations (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.operations(id) on delete cascade,
  site_id text not null,
  node text not null,
  vcpu integer not null,
  memory_gb numeric not null,
  disk_gb numeric not null,
  state text not null default 'held',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes')
);

create table public.catalog_image_site_templates (
  catalog_image_id text not null references public.catalog_images(id),
  site_id text not null,
  proxmox_vmid integer not null,
  proxmox_node text not null,
  proxmox_storage text not null,
  primary key (catalog_image_id, site_id)
);

alter table public.catalog_image_site_templates enable row level security;
create policy "anyone can read catalog image site templates"
  on public.catalog_image_site_templates for select using (true);
grant select on public.catalog_image_site_templates to anon, authenticated;

create table public.warm_pool_vms (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  proxmox_vmid integer not null,
  proxmox_node text not null,
  constraint warm_pool_vms_proxmox_vmid_key unique (proxmox_vmid)
);

insert into public.catalog_images (id)
values ('ubuntu-2404'), ('debian-12'), ('fedora-41');

insert into public.catalog_image_site_templates
  (catalog_image_id, site_id, proxmox_vmid, proxmox_node, proxmox_storage)
values
  ('ubuntu-2404', 'lag-1', 9000, 'nodeD', 'ceph-vm'),
  ('debian-12', 'other-site', 9100, 'other-node', 'other-storage');

insert into public.operations (id, site_id)
values
  ('00000000-0000-0000-0000-000000000001', 'lag-1'),
  ('00000000-0000-0000-0000-000000000002', 'lag-1');

insert into public.instances (id, site_id, proxmox_vmid, proxmox_node)
values ('10000000-0000-0000-0000-000000000001', 'lag-1', 101, 'nodeD');

insert into public.capacity_reservations
  (id, operation_id, site_id, node, vcpu, memory_gb, disk_gb, state,
   created_at, expires_at)
values
  ('20000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'lag-1', 'nodeD', 2, 4, 80, 'held', now(), now() + interval '15 minutes'),
  ('20000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000001',
   'lag-1', 'nodeD', 2, 4, 80, 'committed', now() - interval '1 day',
   now() + interval '15 minutes'),
  ('20000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000001',
   'lag-1', 'nodeD', 2, 4, 80, 'held', now() + interval '1 day',
   now() - interval '1 minute');

insert into public.warm_pool_vms (id, site_id, proxmox_vmid, proxmox_node)
values ('30000000-0000-0000-0000-000000000001', 'lag-1', 201, 'nodeD');
