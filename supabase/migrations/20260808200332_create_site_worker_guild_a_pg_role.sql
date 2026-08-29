-- Dedicated, least-privilege direct-Postgres login role for the Guild-A
-- site worker, attempted when the worker moved off Supabase Edge
-- Functions onto Guild-A's own network. Never ended up in use - Supabase's
-- connection pooler doesn't recognize ad-hoc SQL-created roles, and the
-- direct-connection path needs IPv6 this network doesn't have. Left in
-- place (not dropped) in case those blockers are resolved later. See
-- docs/phase-2/threat-model.md finding #2.
--
-- NOTE: the actual password used in production was generated locally and
-- is not the placeholder below - this migration file documents the grants/
-- policies, not the live credential. Rotate via `alter role
-- site_worker_guild_a with password '...'` if this role is ever revived.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'site_worker_guild_a') then
    create role site_worker_guild_a with login password 'REPLACE_ME_ROTATE_BEFORE_USE';
  end if;
end
$$;
grant connect on database postgres to site_worker_guild_a;
grant usage on schema public to site_worker_guild_a;

grant select, update on public.operations to site_worker_guild_a;
grant select, update on public.operation_stages to site_worker_guild_a;
-- public.instances is created later, by 20260808200500. On the live project
-- this file ran after the table existed; on a from-zero replay it does not yet,
-- so this grant and the matching policy below are applied by
-- 20260808200550 instead, which runs after the table is created.
grant select, insert on public.capacity_reservations to site_worker_guild_a;
grant select on public.catalog_plans to site_worker_guild_a;
-- catalog_image_site_templates is created later, by 20260808200400; its grant
-- is applied by 20260808200550 for the same reason as the instances grant below.
-- get_vault_secret is created by 20260808201000, after this file; its grant is
-- applied by 20260808201050 for the same ordering reason as the others above.

create policy "site_worker_guild_a rw" on operations
  for all to site_worker_guild_a
  using (site_id = 'lag-1')
  with check (site_id = 'lag-1');

create policy "site_worker_guild_a rw" on operation_stages
  for all to site_worker_guild_a
  using (exists (select 1 from operations o where o.id = operation_stages.operation_id and o.site_id = 'lag-1'))
  with check (exists (select 1 from operations o where o.id = operation_stages.operation_id and o.site_id = 'lag-1'));

create policy "site_worker_guild_a rw" on capacity_reservations
  for all to site_worker_guild_a
  using (site_id = 'lag-1')
  with check (site_id = 'lag-1');
