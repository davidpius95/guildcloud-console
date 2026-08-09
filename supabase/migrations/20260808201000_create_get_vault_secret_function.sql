-- The vault schema is deliberately not exposed via PostgREST (Supabase's
-- own default, for good reason - direct vault access from any REST-
-- reachable role would defeat the point of storing secrets there). The
-- site-worker Edge Function needs to read the Proxmox token it stored in
-- vault, so it goes through this narrow, service-role-only wrapper
-- function instead of querying vault.decrypted_secrets directly.
create or replace function public.get_vault_secret(secret_name text)
returns text
language sql
security definer
set search_path to 'public'
as $$
  select decrypted_secret from vault.decrypted_secrets where name = secret_name;
$$;

revoke execute on function public.get_vault_secret(text) from public;
revoke execute on function public.get_vault_secret(text) from anon;
revoke execute on function public.get_vault_secret(text) from authenticated;
grant execute on function public.get_vault_secret(text) to service_role;
