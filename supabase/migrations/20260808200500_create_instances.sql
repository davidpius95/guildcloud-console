-- Phase 2: the real table operations.instance_id points at, and what
-- eventually replaces lib/mock-data.ts's Instance[] for real orgs. Only
-- the createInstance Server Action (as the user's own session) inserts a
-- 'provisioning' row; only the Edge Function worker (service-role key,
-- bypasses RLS) ever updates state/private_ip/proxmox_vmid afterward -
-- there is deliberately no client-facing UPDATE policy.
create table instances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  site_id text not null,
  proxmox_vmid int,
  proxmox_node text,
  name text not null,
  catalog_image_id text not null references catalog_images(id),
  catalog_plan_id text not null references catalog_plans(id),
  private_ip inet,
  state text not null check (state in ('provisioning', 'ready', 'degraded', 'stopped', 'failed', 'deleting')) default 'provisioning',
  created_at timestamptz not null default now()
);

alter table operations
  add constraint operations_instance_id_fkey
  foreign key (instance_id) references instances(id) on delete set null;

alter table instances enable row level security;

create policy "members can select org instances"
  on instances for select
  using (is_org_member(organization_id));

create policy "owners/admins can create instances"
  on instances for insert
  with check (has_org_role(organization_id, array['Owner', 'Admin']));
