-- Real bug found live: vault.delete_secret(uuid) does not exist in this
-- project's Vault extension version (only create_secret/update_secret
-- do) - every real reveal_instance_ssh_password call was throwing
-- "function vault.delete_secret(uuid) does not exist", which the
-- console's revealInstancePassword swallowed into the same response as
-- "already revealed", so no user ever actually saw a real password
-- despite the secret still sitting in vault.secrets untouched. Delete
-- the underlying row directly instead - vault.secrets is a normal table.
create or replace function public.reveal_instance_ssh_password(p_instance_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org_id uuid;
  v_secret_id uuid;
  v_value text;
begin
  select organization_id into v_org_id from instances where id = p_instance_id;
  if v_org_id is null then
    raise exception 'instance not found';
  end if;
  if not public.has_org_role(v_org_id, array['Owner', 'Admin']) then
    raise exception 'not authorized';
  end if;

  select id, decrypted_secret into v_secret_id, v_value
  from vault.decrypted_secrets
  where name = 'instance_ssh_password_' || p_instance_id::text;

  if v_secret_id is null then
    return null;
  end if;

  delete from vault.secrets where id = v_secret_id;
  return v_value;
end;
$function$;
