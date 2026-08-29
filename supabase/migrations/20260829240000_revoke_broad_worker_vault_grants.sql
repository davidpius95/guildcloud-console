-- Close the last hole in the Task 7 boundary.
--
-- 20260829210000 granted guildcloud_site_worker EXECUTE on get_vault_secret and
-- set_vault_secret as a stopgap, to restore service after the cutover removed the
-- service-role key without a replacement path to Vault. Both take a
-- caller-supplied secret name, so a worker could read any secret in the vault,
-- including the other cluster's Proxmox API token. That is the one thing Task 7
-- exists to prevent.
--
-- 20260829230000 added scoped replacements that take no secret name:
--   worker_get_proxmox_credential()                 -> this cluster's token only
--   worker_get_tailscale_oauth()                    -> those two secrets only
--   worker_set_instance_ssh_password(uuid, text)    -> instances in this cluster
--
-- APPLY THIS ONLY AFTER the worker code using them is deployed and verified on
-- every cluster. Applying it earlier removes the worker's Vault access before
-- anything can use its replacement, which is precisely how the cutover broke two
-- clusters on 2026-08-29.
--
-- service_role keeps both functions: Edge Functions (send-invite-email,
-- enroll-device) call get_vault_secret directly and are not part of the worker
-- boundary.

revoke execute on function public.get_vault_secret(text) from guildcloud_site_worker;
revoke execute on function public.set_vault_secret(text, text) from guildcloud_site_worker;

comment on function public.get_vault_secret(text) is
  'Reads a Vault secret by name. SECURITY DEFINER, service_role only. Site '
  'workers must NOT be granted this: it accepts an arbitrary name and so ignores '
  'the per-cluster isolation the worker boundary enforces. They use '
  'worker_get_proxmox_credential() and worker_get_tailscale_oauth() instead, '
  'which resolve what may be read from the caller''s identity.';

comment on function public.set_vault_secret(text, text) is
  'Writes a Vault secret by name. SECURITY DEFINER, service_role only. Site '
  'workers use worker_set_instance_ssh_password(uuid, text), which derives the '
  'secret name from the instance id and refuses instances outside the caller''s '
  'cluster.';
