create table public.infrastructure_clusters (
  id text,
  site_id text not null,
  name text not null,
  enabled boolean not null default false,
  admission_state text not null default 'paused',
  worker_id text,
  worker_heartbeat_at timestamptz,
  capacity_observed_at timestamptz,
  private_networking_healthy boolean not null default false,
  backup_healthy boolean not null default false,
  monitoring_healthy boolean not null default false,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint infrastructure_clusters_pkey primary key (id),
  constraint infrastructure_clusters_admission_state_check
    check (admission_state in ('open', 'draining', 'paused'))
);

create table public.infrastructure_nodes (
  cluster_id text not null,
  node text not null,
  enabled boolean not null default false,
  admission_state text not null default 'paused',
  online boolean not null default false,
  total_vcpu integer not null default 0,
  committed_vcpu integer not null default 0,
  total_memory_bytes bigint not null default 0,
  used_memory_bytes bigint not null default 0,
  committed_memory_bytes bigint not null default 0,
  cpu_utilization numeric not null default 0,
  observed_at timestamptz,
  failure_reason text,
  constraint infrastructure_nodes_pkey primary key (cluster_id, node),
  constraint infrastructure_nodes_cluster_id_fkey
    foreign key (cluster_id)
    references public.infrastructure_clusters(id) on delete cascade,
  constraint infrastructure_nodes_admission_state_check
    check (admission_state in ('open', 'draining', 'paused')),
  constraint infrastructure_nodes_capacity_nonnegative_check
    check (
      total_vcpu >= 0 and committed_vcpu >= 0 and
      total_memory_bytes >= 0 and used_memory_bytes >= 0 and
      committed_memory_bytes >= 0
    ),
  constraint infrastructure_nodes_cpu_utilization_check
    check (cpu_utilization >= 0 and cpu_utilization <= 1)
);

create table public.infrastructure_storage_targets (
  id uuid not null default gen_random_uuid(),
  cluster_id text not null,
  storage_id text not null,
  node text,
  enabled boolean not null default false,
  healthy boolean not null default false,
  shared boolean not null default false,
  total_bytes bigint not null default 0,
  used_bytes bigint not null default 0,
  observed_at timestamptz,
  failure_reason text,
  constraint infrastructure_storage_targets_pkey primary key (id),
  constraint infrastructure_storage_targets_cluster_id_fkey
    foreign key (cluster_id)
    references public.infrastructure_clusters(id) on delete cascade,
  constraint infrastructure_storage_targets_topology_check
    check ((shared and node is null) or (not shared and node is not null)),
  constraint infrastructure_storage_targets_bytes_nonnegative_check
    check (total_bytes >= 0 and used_bytes >= 0),
  constraint infrastructure_storage_targets_capacity_check
    check (total_bytes <= 0 or used_bytes <= total_bytes)
);

create unique index infrastructure_storage_targets_shared_key
  on public.infrastructure_storage_targets (cluster_id, storage_id)
  where shared;

create unique index infrastructure_storage_targets_local_key
  on public.infrastructure_storage_targets (cluster_id, node, storage_id)
  where not shared;

create table public.catalog_image_cluster_templates (
  catalog_image_id text not null,
  cluster_id text not null,
  source_node text not null,
  proxmox_vmid integer not null,
  storage_id text not null,
  target_nodes text[] not null default '{}',
  clone_mode text not null default 'full',
  enabled boolean not null default false,
  tested_at timestamptz,
  template_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_image_cluster_templates_pkey
    primary key (catalog_image_id, cluster_id),
  constraint catalog_image_cluster_templates_catalog_image_id_fkey
    foreign key (catalog_image_id) references public.catalog_images(id),
  constraint catalog_image_cluster_templates_cluster_id_fkey
    foreign key (cluster_id)
    references public.infrastructure_clusters(id) on delete cascade,
  constraint catalog_image_cluster_templates_cluster_vmid_key
    unique (cluster_id, proxmox_vmid),
  constraint catalog_image_cluster_templates_clone_mode_check
    check (clone_mode in ('linked', 'full')),
  constraint catalog_image_cluster_templates_enabled_check
    check (
      not enabled or
      (tested_at is not null and cardinality(target_nodes) > 0)
    )
);

create table public.placement_settings (
  id boolean not null default true,
  mode text not null default 'single',
  updated_at timestamptz not null default now(),
  constraint placement_settings_pkey primary key (id),
  constraint placement_settings_id_check check (id),
  constraint placement_settings_mode_check
    check (mode in ('single', 'shadow', 'multi'))
);

insert into public.infrastructure_clusters
  (id, site_id, name, enabled, admission_state)
values ('guild-a', 'lag-1', 'Guild-A', true, 'paused');

insert into public.placement_settings default values;

alter table public.operations
  add column cluster_id text,
  add column assigned_node text,
  add column storage_id text,
  add column placement_decision jsonb,
  add constraint operations_cluster_id_fkey
    foreign key (cluster_id) references public.infrastructure_clusters(id);

update public.operations set cluster_id = 'guild-a' where cluster_id is null;

alter table public.instances
  add column cluster_id text,
  add constraint instances_cluster_id_fkey
    foreign key (cluster_id) references public.infrastructure_clusters(id);

update public.instances set cluster_id = 'guild-a' where cluster_id is null;

alter table public.instances
  drop constraint if exists instances_proxmox_vmid_key;

create unique index instances_cluster_vmid_key
  on public.instances (cluster_id, proxmox_vmid)
  where proxmox_vmid is not null;

alter table public.capacity_reservations
  add column cluster_id text,
  add column storage_id text;

update public.capacity_reservations
set cluster_id = 'guild-a', storage_id = 'ceph-vm'
where cluster_id is null or storage_id is null;

alter table public.capacity_reservations
  alter column cluster_id set not null,
  alter column storage_id set not null,
  add constraint capacity_reservations_cluster_id_fkey
    foreign key (cluster_id) references public.infrastructure_clusters(id),
  add constraint capacity_reservations_operation_key unique (operation_id);

alter table public.warm_pool_vms
  add column cluster_id text;

update public.warm_pool_vms set cluster_id = 'guild-a' where cluster_id is null;

alter table public.warm_pool_vms
  alter column cluster_id set not null,
  drop constraint warm_pool_vms_proxmox_vmid_key,
  add constraint warm_pool_vms_cluster_id_fkey
    foreign key (cluster_id) references public.infrastructure_clusters(id),
  add constraint warm_pool_vms_cluster_vmid_key
    unique (cluster_id, proxmox_vmid);

insert into public.catalog_image_cluster_templates
  (catalog_image_id, cluster_id, source_node, proxmox_vmid, storage_id,
   target_nodes, clone_mode, enabled, tested_at, template_version)
select
  catalog_image_id,
  'guild-a',
  proxmox_node,
  proxmox_vmid,
  proxmox_storage,
  array[]::text[],
  'full',
  false,
  null,
  'legacy-guild-a'
from public.catalog_image_site_templates
where site_id = 'lag-1';

alter table public.infrastructure_clusters enable row level security;
alter table public.infrastructure_nodes enable row level security;
alter table public.infrastructure_storage_targets enable row level security;
alter table public.catalog_image_cluster_templates enable row level security;
alter table public.placement_settings enable row level security;

revoke all privileges on table public.infrastructure_clusters
  from public, anon, authenticated;
revoke all privileges on table public.infrastructure_nodes
  from public, anon, authenticated;
revoke all privileges on table public.infrastructure_storage_targets
  from public, anon, authenticated;
revoke all privileges on table public.catalog_image_cluster_templates
  from public, anon, authenticated;
revoke all privileges on table public.placement_settings
  from public, anon, authenticated;

grant select, insert, update, delete
  on table public.infrastructure_clusters to service_role;
grant select, insert, update, delete
  on table public.infrastructure_nodes to service_role;
grant select, insert, update, delete
  on table public.infrastructure_storage_targets to service_role;
grant select, insert, update, delete
  on table public.catalog_image_cluster_templates to service_role;
grant select, insert, update, delete
  on table public.placement_settings to service_role;
