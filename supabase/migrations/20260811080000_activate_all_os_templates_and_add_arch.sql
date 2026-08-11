-- Phase 2/3: Activate all OS templates (Debian 13, Fedora 43, Rocky Linux 10, AlmaLinux 10)
-- and add Arch Linux cloud-init template for site lag-1 (Guild-A).

-- 1. Insert Arch Linux into catalog_images if not present
insert into catalog_images (id, name, version, family, recommended, available_sites)
values ('arch-linux', 'Arch Linux', 'Rolling', 'os', false, array['lag-1'])
on conflict (id) do update
set available_sites = array['lag-1'];

-- 2. Insert site template mappings into catalog_image_site_templates
insert into catalog_image_site_templates (catalog_image_id, site_id, proxmox_vmid, proxmox_node, proxmox_storage)
values
  ('debian-12', 'lag-1', 9001, 'nodeD', 'ceph-vm'),
  ('fedora-41', 'lag-1', 9003, 'nodeD', 'ceph-vm'),
  ('rocky-9',   'lag-1', 9004, 'nodeD', 'ceph-vm'),
  ('alma-9',    'lag-1', 9005, 'nodeD', 'ceph-vm'),
  ('arch-linux', 'lag-1', 9006, 'nodeD', 'ceph-vm')
on conflict (catalog_image_id, site_id) do update
set proxmox_vmid = excluded.proxmox_vmid,
    proxmox_node = excluded.proxmox_node,
    proxmox_storage = excluded.proxmox_storage;
