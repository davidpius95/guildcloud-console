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
create role site_worker_guild_a with login password 'REPLACE_ME_ROTATE_BEFORE_USE';
grant connect on database postgres to site_worker_guild_a;
grant usage on schema public to site_worker_guild_a;

grant select, update on public.operations to site_worker_guild_a;
grant select, update on public.operation_stages to site_worker_guild_a;
grant select, update, insert on public.instances to site_worker_guild_a;
grant select, insert on public.capacity_reservations to site_worker_guild_a;
grant select on public.catalog_plans to site_worker_guild_a;
grant select on public.catalog_image_site_templates to site_worker_guild_a;
grant execute on function public.get_vault_secret(text) to site_worker_guild_a;

create policy "site_worker_guild_a rw" on operations
  for all to site_worker_guild_a
  using (site_id = 'lag-1')
  with check (site_id = 'lag-1');

create policy "site_worker_guild_a rw" on operation_stages
  for all to site_worker_guild_a
  using (exists (select 1 from operations o where o.id = operation_stages.operation_id and o.site_id = 'lag-1'))
  with check (exists (select 1 from operations o where o.id = operation_stages.operation_id and o.site_id = 'lag-1'));

create policy "site_worker_guild_a rw" on instances
  for all to site_worker_guild_a
  using (site_id = 'lag-1')
  with check (site_id = 'lag-1');

create policy "site_worker_guild_a rw" on capacity_reservations
  for all to site_worker_guild_a
  using (site_id = 'lag-1')
  with check (site_id = 'lag-1');
