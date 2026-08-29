-- Baseline repair (see 00000000000000_baseline_phase1_schema.sql).
--
-- Last of the grants relocated out of 20260808200332, whose timestamp places it
-- before several of the objects it grants on. public.get_vault_secret(text) is
-- created by 20260808201000, so the grant has to land after that file rather
-- than inside 20260808200332. Guarded, so it is a no-op on the live project.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'site_worker_guild_a') then
    grant execute on function public.get_vault_secret(text) to site_worker_guild_a;
  end if;
end
$$;
