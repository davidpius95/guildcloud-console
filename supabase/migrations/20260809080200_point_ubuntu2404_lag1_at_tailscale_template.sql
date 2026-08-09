-- Repoints Ubuntu 24.04/Guild-A at vmid 9011 (ubuntu-2604-guildvm-template-ts),
-- a fresh full clone of 9010 with Tailscale pre-installed on disk (service
-- disabled, no state file) - built for Phase 3 private access, so the
-- per-clone hot path is just "tailscale up" with a fresh ephemeral key,
-- never a package install. 9010 stays untouched as rollback. See
-- docs/dev-log for the build/verification steps and
-- docs/phase-3/threat-model.md for why Tailscale is pre-baked rather than
-- installed per-clone (this is the exact class of first-boot network
-- install that the 2026-08-09 speed fix already removed once).
update catalog_image_site_templates
set proxmox_vmid = 9011
where catalog_image_id = 'ubuntu-2404' and site_id = 'lag-1';
