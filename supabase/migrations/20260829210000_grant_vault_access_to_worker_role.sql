-- Restore the site worker's access to Vault after the Task 7 cutover.
--
-- The Task 7 boundary enumerated the worker's table access and replaced it with
-- worker_* RPCs, but missed that the worker also reads Vault: index.js calls
-- get_vault_secret to fetch its Proxmox API token, and set_vault_secret to store
-- per-instance SSH passwords. Both were granted to service_role and to the old
-- per-cluster role site_worker_guild_a, and never to guildcloud_site_worker.
--
-- So the Guild-B cutover on 2026-08-29 took the service-role key away and with
-- it the Proxmox credential. The worker kept heartbeating -- worker_heartbeat
-- needs no Vault -- while every Proxmox operation failed with
-- "permission denied for function get_vault_secret". The --health check passed
-- throughout, because it proves the control plane is reachable and never
-- exercises the credential path. A health check that cannot fail the way
-- production fails is not a health check.
--
-- THIS IS A STOPGAP, and it is deliberately weaker than the rest of the
-- boundary. get_vault_secret takes an arbitrary secret name, so any worker
-- holding this grant can read ANY secret in the vault -- including the other
-- cluster's Proxmox token. That breaks the cluster isolation Task 7 exists to
-- enforce.
--
-- It is still a strict improvement on what it replaces. Before tonight the
-- worker held the service-role key, which could read every secret AND bypass
-- RLS on every table. This grant is a subset of that. Rolling back to
-- service_role to avoid it would be strictly worse on both counts, which is why
-- the grant is the right immediate move and the rollback is not.
--
-- The proper fix is a scoped pair of RPCs that resolve the cluster from
-- worker_identities and never accept a caller-supplied secret name:
--   worker_get_proxmox_credential()            -> this worker's cluster only
--   worker_set_instance_ssh_password(uuid,text) -> instances in its own cluster
-- Tracked as follow-up; this file should be superseded by them, not extended.

grant execute on function public.get_vault_secret(text) to guildcloud_site_worker;
grant execute on function public.set_vault_secret(text, text) to guildcloud_site_worker;

comment on function public.get_vault_secret(text) is
  'Reads a Vault secret by name. SECURITY DEFINER. Granted to service_role and '
  'guildcloud_site_worker. The worker grant is a stopgap from 2026-08-29: it '
  'accepts an arbitrary name, so it does not honour the per-cluster isolation '
  'the Task 7 boundary enforces everywhere else. Replace with '
  'worker_get_proxmox_credential().';
