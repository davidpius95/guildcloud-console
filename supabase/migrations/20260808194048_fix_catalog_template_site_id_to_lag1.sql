-- Real mismatch found and fixed before the console's submission path was
-- wired up: every prior migration used site_id = 'guild-a', matching the
-- real infrastructure's own naming, but lib/mock-data.ts's sites array
-- (which the wizard actually reads and submits) uses purely fictional,
-- customer-facing ids (lag-1, abj-1, ams-1) that were never mapped to
-- real infrastructure naming before this phase. lag-1 is the default/
-- primary mock site, so it's the id treated as backed by real Guild-A
-- hardware. See docs/phase-2/data-model.md.
-- Guarded on table existence: this file's timestamp puts it BEFORE
-- 20260808200400, which is what actually creates catalog_image_site_templates.
-- That ordering is wrong but harmless on the live project, where the table
-- already existed when this ran. On a from-zero replay the table genuinely does
-- not exist yet, and the later migration seeds its rows with site_id 'lag-1'
-- already, so skipping here loses nothing. See docs/REPLICATION.md.
do $$
begin
  if to_regclass('public.catalog_image_site_templates') is not null then
    update catalog_image_site_templates set site_id = 'lag-1' where site_id = 'guild-a';
  end if;
end
$$;
-- Same ordering caveat: operations.site_id is added by 20260808200100, which
-- runs after this file and already defaults it to 'guild-a'. On a from-zero
-- replay the column does not exist yet; 20260808200550 re-applies this default
-- once it does.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'operations' and column_name = 'site_id'
  ) then
    alter table operations alter column site_id set default 'lag-1';
  end if;
end
$$;
