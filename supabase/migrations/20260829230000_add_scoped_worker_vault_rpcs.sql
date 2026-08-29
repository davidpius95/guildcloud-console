-- Scoped Vault access for site workers, replacing the stopgap grant.
--
-- 20260829210000 granted guildcloud_site_worker EXECUTE on get_vault_secret and
-- set_vault_secret to restore service after the Task 7 cutover. Both take a
-- caller-supplied secret name, so a worker could read ANY secret -- including the
-- other cluster's Proxmox token. Task 7 exists to stop a worker affecting
-- anything outside its own cluster, and that grant was the one hole left in it.
--
-- These three functions take no secret name from the caller. Each resolves what
-- it may touch from the database, the same way every other worker_* RPC does.
--
-- This migration is ADDITIVE ONLY. The broad grants are revoked in a separate
-- migration applied after the worker code is deployed and verified. Doing both at
-- once is how the cutover broke two clusters: the credential disappeared before
-- anything could use its replacement.

-- Which Vault secret holds each cluster's Proxmox API token. In the database
-- rather than the worker's env file, so the worker cannot name a different
-- cluster's secret -- previously PVE_TOKEN_SECRET_NAME was env-supplied and
-- passed straight through to get_vault_secret.
alter table public.infrastructure_clusters
  add column if not exists proxmox_token_secret_name text;

comment on column public.infrastructure_clusters.proxmox_token_secret_name is
  'Name of the Vault secret holding this cluster''s Proxmox API token. Read only '
  'by worker_get_proxmox_credential(), which resolves the cluster from the '
  'caller''s identity so a worker cannot request another cluster''s token.';

update public.infrastructure_clusters
set proxmox_token_secret_name = 'proxmox_' || replace(id, '-', '_') || '_site_worker_token'
where proxmox_token_secret_name is null;

-- Fail loudly now rather than at 3am: every enabled cluster must map to a secret
-- that actually exists, or its worker cannot function.
do $$
declare
  v_missing text;
begin
  select string_agg(c.id || ' -> ' || coalesce(c.proxmox_token_secret_name, '<null>'), ', ')
    into v_missing
  from public.infrastructure_clusters as c
  where c.enabled
    and not exists (select 1 from vault.secrets as s where s.name = c.proxmox_token_secret_name);

  if v_missing is not null then
    raise exception 'clusters with no matching Vault secret: %', v_missing;
  end if;
end
$$;

-- This worker's Proxmox API token. No argument: the cluster comes from the
-- caller's identity, so there is nothing to point at another cluster.
create or replace function public.worker_get_proxmox_credential()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cluster_id text := public.current_worker_cluster();
  v_secret_name text;
  v_secret text;
begin
  select cluster.proxmox_token_secret_name into v_secret_name
  from public.infrastructure_clusters as cluster
  where cluster.id = v_cluster_id;

  if v_secret_name is null then
    raise exception using errcode = '42704',
      message = format('cluster %L has no proxmox_token_secret_name configured', v_cluster_id);
  end if;

  -- Calling get_vault_secret from inside a SECURITY DEFINER function owned by
  -- postgres runs as postgres, so this keeps working after the worker role's
  -- own grant on it is revoked. Vault access stays in one wrapper.
  v_secret := public.get_vault_secret(v_secret_name);

  if v_secret is null then
    raise exception using errcode = '42704',
      message = format('Vault has no secret named %L for cluster %L', v_secret_name, v_cluster_id);
  end if;

  return v_secret;
end
$$;

-- The Tailscale OAuth client. Tailnet-wide rather than cluster-scoped -- every
-- worker deletes the devices of instances it tears down, so restricting this to
-- the housekeeper would break ordinary deletion. The gain here is not isolation
-- but that the caller supplies no name: this returns these two secrets or
-- nothing, where the stopgap grant could read the whole vault.
create or replace function public.worker_get_tailscale_oauth()
returns table (client_id text, client_secret text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.current_worker_cluster();

  return query
  select public.get_vault_secret('tailscale_guildcloud_worker_oauth_client_id'),
         public.get_vault_secret('tailscale_guildcloud_worker_oauth_client_secret');
end
$$;

-- Store an instance's SSH password. The secret name is DERIVED from the instance
-- id, never supplied, and the instance must belong to the caller's cluster -- so
-- this cannot be used to overwrite another cluster's instance password, or any
-- other secret, by choosing a name.
create or replace function public.worker_set_instance_ssh_password(
  p_instance_id uuid,
  p_password text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Raises P0002 when the instance is not in this worker's cluster.
  perform public.assert_worker_owns_instance(p_instance_id);

  if p_password is null or length(p_password) = 0 then
    raise exception using errcode = '22023', message = 'password must not be empty';
  end if;

  perform public.set_vault_secret('instance_ssh_password_' || p_instance_id::text, p_password);
end
$$;

-- Postgres grants EXECUTE to PUBLIC by default and anon/authenticated inherit
-- it, so each of these must be revoked from PUBLIC before being granted to the
-- worker role. Revoking from the role alone would leave them callable by anyone.
revoke execute on function public.worker_get_proxmox_credential()
  from public, anon, authenticated;
revoke execute on function public.worker_get_tailscale_oauth()
  from public, anon, authenticated;
revoke execute on function public.worker_set_instance_ssh_password(uuid, text)
  from public, anon, authenticated;

grant execute on function public.worker_get_proxmox_credential() to guildcloud_site_worker;
grant execute on function public.worker_get_tailscale_oauth() to guildcloud_site_worker;
grant execute on function public.worker_set_instance_ssh_password(uuid, text) to guildcloud_site_worker;
