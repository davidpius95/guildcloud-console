-- catalog_image_cluster_templates (added by 20260818090000) records ONE
-- source_node/proxmox_vmid per (image, cluster) - correct for Guild-A, whose
-- VM storage (ceph-vm) is shared, so a single template on nodeD is
-- linked-clonable onto any node. Guild-B's VM storage (local-lvm) is
-- per-node lvmthin: `qm clone --target` is refused when the source disk is
-- on non-shared storage, so a template on podA simply does not exist as a
-- clone source for podE or podF - each admitted node needs its own template
-- VM with its own VMID.
--
-- catalog_image_cluster_templates stays exactly as committed and keeps
-- gating admission (place_next_pending_operation only reads its enabled/
-- tested_at/target_nodes/storage_id columns, never the VMID) - this table
-- adds the per-node resolution the worker needs at clone time, without
-- touching that committed schema or RPC.
create table public.catalog_image_cluster_node_templates (
  catalog_image_id text not null references public.catalog_images(id),
  cluster_id text not null
    references public.infrastructure_clusters(id) on delete cascade,
  node text not null,
  source_node text not null,
  proxmox_vmid integer not null,
  storage_id text not null,
  clone_mode text not null default 'linked',
  enabled boolean not null default false,
  tested_at timestamptz,
  template_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_image_cluster_node_templates_pkey
    primary key (catalog_image_id, cluster_id, node),
  constraint catalog_image_cluster_node_templates_clone_mode_check
    check (clone_mode in ('linked', 'full')),
  constraint catalog_image_cluster_node_templates_enabled_requires_tested_check
    check (not enabled or tested_at is not null),
  -- A Proxmox VMID is unique cluster-wide (a VM cannot exist as two
  -- different VMIDs, or the same VMID as two different VMs, within one
  -- cluster) - node-scoping this would have let the same VMID be
  -- registered against two nodes as if they were different template VMs.
  constraint catalog_image_cluster_node_templates_cluster_vmid_key
    unique (cluster_id, proxmox_vmid)
);

comment on table public.catalog_image_cluster_node_templates is
  'Per-node clone source for a cluster template. catalog_image_cluster_templates.target_nodes lists WHICH nodes are admitted for an image; every node listed there must have a matching enabled row here or the worker cannot actually clone onto it (see the pgTAP invariant in multi_cluster_node_templates.sql). Guild-A: one row per (image, node), all pointing at source_node=nodeD (shared ceph-vm). Guild-B: one row per (image, node), source_node = node itself (per-node local-lvm).';

create index catalog_image_cluster_node_templates_cluster_node_idx
  on public.catalog_image_cluster_node_templates (cluster_id, node);

-- Backfill: Guild-A's existing single-node template rows (nodeD only,
-- disabled - see 20260818090000) become one row here per the same node.
-- Still disabled/untested: enabling happens only once Phase R2 of the
-- rollout populates target_nodes and re-tests, same as the parent table.
insert into public.catalog_image_cluster_node_templates
  (catalog_image_id, cluster_id, node, source_node, proxmox_vmid, storage_id,
   clone_mode, enabled, tested_at, template_version)
select
  catalog_image_id, cluster_id, source_node, source_node, proxmox_vmid,
  storage_id, 'linked', false, null, template_version
from public.catalog_image_cluster_templates
where cluster_id = 'guild-a';

alter table public.catalog_image_cluster_node_templates enable row level security;

revoke all privileges on table public.catalog_image_cluster_node_templates
  from public, anon, authenticated;

grant select, insert, update, delete
  on table public.catalog_image_cluster_node_templates to service_role;
