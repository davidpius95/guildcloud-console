-- Real per-org SSH key storage - backs a Settings-page feature that was
-- previously pure mock (hardcoded array, no onClick handlers at all).
-- Every key an org adds gets injected into every new instance's cloud-init
-- sshkeys field by the site worker, replacing the Guild-A template's one
-- fixed, shared key. See docs/phase-2/threat-model.md finding #7.
create table ssh_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  public_key text not null check (public_key ~ '^(ssh-ed25519|ssh-rsa|ecdsa-sha2-[a-z0-9-]+) '),
  created_at timestamptz not null default now()
);

alter table ssh_keys enable row level security;

create policy "org members can view ssh keys" on ssh_keys
  for select using (is_org_member(organization_id));

create policy "owners/admins can add ssh keys" on ssh_keys
  for insert with check (has_org_role(organization_id, array['Owner', 'Admin']));

create policy "owners/admins can remove ssh keys" on ssh_keys
  for delete using (has_org_role(organization_id, array['Owner', 'Admin']));
