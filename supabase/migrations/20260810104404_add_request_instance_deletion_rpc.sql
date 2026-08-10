-- Real bug found live: `instances` has RLS policies for SELECT (org
-- members) and INSERT (Owner/Admin) but no UPDATE policy for regular
-- authenticated users at all - only the site worker's own service-role
-- policy. deleteInstance's plain `.update({state: 'deleting'})` from the
-- console therefore matched zero rows under RLS and returned no error
-- (a classic silent-RLS-noop), so the button appeared to work (redirected,
-- no error shown) while the instance was never actually touched.
--
-- Mirrors reveal_instance_ssh_password's existing pattern rather than
-- adding a broad UPDATE grant on `instances` (which would let any org
-- member rewrite arbitrary columns, not just request deletion): a
-- SECURITY DEFINER RPC that does its own internal Owner/Admin check and
-- only ever transitions state to 'deleting'.
create or replace function public.request_instance_deletion(p_instance_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select organization_id into v_org_id from instances where id = p_instance_id;
  if v_org_id is null then
    raise exception 'instance not found';
  end if;
  if not public.has_org_role(v_org_id, array['Owner', 'Admin']) then
    raise exception 'not authorized';
  end if;

  update instances set state = 'deleting' where id = p_instance_id and state <> 'deleting';
end;
$$;

revoke execute on function public.request_instance_deletion(uuid) from public, anon;
grant execute on function public.request_instance_deletion(uuid) to authenticated;
