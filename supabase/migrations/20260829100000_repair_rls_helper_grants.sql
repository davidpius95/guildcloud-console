-- Reassert the runtime grants required by authenticated RLS policies.
-- Earlier Phase 1 CREATE OR REPLACE migrations reset function ACLs; production
-- later emitted "permission denied for function is_org_member" while rendering
-- an authenticated instance detail route. Keep anon/PUBLIC locked out while
-- guaranteeing that authenticated policies can execute the helpers.
do $$
begin
  if to_regprocedure('public.is_org_member(uuid)') is null then
    raise exception 'Required function public.is_org_member(uuid) is missing';
  end if;
  if to_regprocedure('public.has_org_role(uuid,text[])') is null then
    raise exception 'Required function public.has_org_role(uuid,text[]) is missing';
  end if;

  execute 'revoke execute on function public.is_org_member(uuid) from public, anon';
  execute 'revoke execute on function public.has_org_role(uuid, text[]) from public, anon';
  execute 'grant execute on function public.is_org_member(uuid) to authenticated';
  execute 'grant execute on function public.has_org_role(uuid, text[]) to authenticated';
end
$$;
