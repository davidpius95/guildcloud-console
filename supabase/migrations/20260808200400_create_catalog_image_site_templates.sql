-- Phase 2: resolves the real mismatch between the seeded placeholder
-- catalog_images (Ubuntu 24.04, Debian 12, Fedora 41, Rocky 9, AlmaLinux 9,
-- Docker, WordPress - copied verbatim from lib/mock-data.ts in Phase 1)
-- and the real Guild-A templates from the Phase 0 template catalogue
-- (Ubuntu 26.04, Debian 13, Fedora 43, Rocky 10.2, AlmaLinux 10.2), without
-- silently renaming either side. Public read (same as catalog_images/
-- catalog_plans), no client write - this is operator-curated data.
create table catalog_image_site_templates (
  catalog_image_id text not null references catalog_images(id),
  site_id text not null,
  proxmox_vmid int not null,
  proxmox_node text not null,
  proxmox_storage text not null,
  primary key (catalog_image_id, site_id)
);

alter table catalog_image_site_templates enable row level security;

create policy "anyone can read catalog image site templates"
  on catalog_image_site_templates for select
  using (true);

-- Seeded row for this phase's end-to-end slice only. Deliberately maps
-- the placeholder "ubuntu-2404" catalog row to the real VMID 9000
-- template, which is actually Ubuntu 26.04 (see
-- docs/decisions/2026-08-08-g10-template-catalogue.md) - the version
-- mismatch is intentional and documented, not a data-entry error. No
-- other catalog_images row gets a mapping yet: Docker and WordPress have
-- no real template built at all, so the console's existing "No tested
-- template at {site}" copy correctly keeps them unavailable at Guild-A
-- once this table drives that check.
insert into catalog_image_site_templates (catalog_image_id, site_id, proxmox_vmid, proxmox_node, proxmox_storage)
values ('ubuntu-2404', 'guild-a', 9000, 'nodeD', 'ceph-vm');
