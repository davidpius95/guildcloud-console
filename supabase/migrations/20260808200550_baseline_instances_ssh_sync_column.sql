-- Baseline repair, part 2 (see 00000000000000_baseline_phase1_schema.sql).
--
-- `instances.ssh_keys_sync_pending` exists in the live control plane but was
-- added straight to the hosted project, never through a tracked migration.
-- 20260808200500 creates `instances` without it, so a from-zero rebuild
-- produced a table that later migrations and the site worker both depend on:
--
--   * 20260829130000's worker_update_instance_runtime patches it, and
--     worker_list_pending_ssh_key_syncs filters on it
--   * mark_org_instances_ssh_dirty() sets it
--
-- Placed immediately after the table is created so a replay has the column from
-- the moment it is first needed.
--
-- NOTE: `instances.updated_at` is deliberately NOT added here. 20260829190000
-- owns it, and adds it NULLABLE with no backfill on purpose -- NULL means "not
-- updated since the column was added", and inventing a default would reintroduce
-- the plausible-but-wrong timestamp that migration exists to eliminate. Adding it
-- early with a default would silently win, because that migration uses
-- `add column if not exists`.
--
-- Every statement is guarded, so this is a no-op on the live project.

alter table public.instances
  add column if not exists ssh_keys_sync_pending boolean not null default false;

-- Moved here from 20260808200332, which grants the (never-used) direct-Postgres
-- site_worker_guild_a role access to the control-plane tables. That file's
-- timestamp puts it before public.instances and catalog_image_site_templates
-- exist, so those grants could not replay from zero. Guarded, so this is a no-op
-- on the live project where they already exist.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'site_worker_guild_a') then
    grant select, update, insert on public.instances to site_worker_guild_a;
    grant select on public.catalog_image_site_templates to site_worker_guild_a;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'instances'
        and policyname = 'site_worker_guild_a rw'
    ) then
      create policy "site_worker_guild_a rw" on public.instances
        for all to site_worker_guild_a
        using (site_id = 'lag-1')
        with check (site_id = 'lag-1');
    end if;
  end if;
end
$$;

-- Re-applies the 'lag-1' default that 20260808194048 could not set, because
-- operations.site_id is only added by 20260808200100. See that file's comment.
alter table public.operations alter column site_id set default 'lag-1';
