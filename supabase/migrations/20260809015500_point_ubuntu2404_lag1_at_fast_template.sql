-- Rebuilt the Guild-A Ubuntu template without its cloud-init vendor-data
-- step, after a real speed investigation found it ran apt-get update +
-- a full curl-install of Tailscale (using a since-exposed, hardcoded auth
-- key) on every clone's first boot. See docs/phase-2/threat-model.md
-- findings #8-#9. Original template (vmid 9000) is untouched, kept as
-- rollback - not deleted.
update catalog_image_site_templates
set proxmox_vmid = 9010
where catalog_image_id = 'ubuntu-2404' and site_id = 'lag-1';
