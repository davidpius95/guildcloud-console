-- Let the worker clear a runtime column, not only set it.
--
-- worker_update_instance_runtime patched with coalesce(new, old), so a null
-- meant "leave alone" and a column could never be cleared. The non-boundary
-- path it replaced (`update(patch)`) has always set nulls, so the two paths
-- disagreed about what a null in the patch means -- a divergence that only
-- mattered once something needed to clear a value.
--
-- Rolling back a failed create needs exactly that. When the compensating
-- action destroys the clone, the instance must stop pointing at a vmid that no
-- longer exists: Proxmox reuses vmids, so a stale proxmox_vmid on a failed
-- instance is a live hazard -- a later delete would target whatever guest now
-- holds that id on that node, and destroy someone else's server.
--
-- Semantics are now "a key present in the patch is applied, including null;
-- a key absent is left alone", which is what the legacy path always did.
-- Every existing caller passes only keys it intends to set, so nothing else
-- changes behaviour.

create or replace function public.worker_update_instance_runtime(
  p_instance_id uuid,
  p_patch jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_instance public.instances%rowtype;
  v_key text;
  v_allowed constant text[] := array[
    'proxmox_vmid', 'proxmox_node', 'storage_id', 'private_ip',
    'private_hostname', 'tailscale_device_id', 'ssh_keys_sync_pending'
  ];
begin
  v_instance := public.assert_worker_owns_instance(p_instance_id);

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception using errcode = '22023', message = 'patch must be a JSON object';
  end if;

  for v_key in select jsonb_object_keys(p_patch) loop
    if not (v_key = any(v_allowed)) then
      raise exception using errcode = '42501',
        message = format('column %L is not worker-writable', v_key);
    end if;
  end loop;

  update public.instances
  set proxmox_vmid = case when p_patch ? 'proxmox_vmid'
        then (p_patch ->> 'proxmox_vmid')::integer else proxmox_vmid end,
      proxmox_node = case when p_patch ? 'proxmox_node'
        then p_patch ->> 'proxmox_node' else proxmox_node end,
      storage_id = case when p_patch ? 'storage_id'
        then p_patch ->> 'storage_id' else storage_id end,
      private_ip = case when p_patch ? 'private_ip'
        then (p_patch ->> 'private_ip')::inet else private_ip end,
      private_hostname = case when p_patch ? 'private_hostname'
        then p_patch ->> 'private_hostname' else private_hostname end,
      tailscale_device_id = case when p_patch ? 'tailscale_device_id'
        then p_patch ->> 'tailscale_device_id' else tailscale_device_id end,
      ssh_keys_sync_pending = case when p_patch ? 'ssh_keys_sync_pending'
        then (p_patch ->> 'ssh_keys_sync_pending')::boolean else ssh_keys_sync_pending end
  where id = v_instance.id;
end
$$;

-- Unchanged from 20260829130000, restated because CREATE OR REPLACE does not
-- re-apply them and the default PUBLIC grant returns on replace.
revoke execute on function public.worker_update_instance_runtime(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.worker_update_instance_runtime(uuid, jsonb) to guildcloud_site_worker;
