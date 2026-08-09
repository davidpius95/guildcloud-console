-- Real mismatch found and fixed before the console's submission path was
-- wired up: every prior migration used site_id = 'guild-a', matching the
-- real infrastructure's own naming, but lib/mock-data.ts's sites array
-- (which the wizard actually reads and submits) uses purely fictional,
-- customer-facing ids (lag-1, abj-1, ams-1) that were never mapped to
-- real infrastructure naming before this phase. lag-1 is the default/
-- primary mock site, so it's the id treated as backed by real Guild-A
-- hardware. See docs/phase-2/data-model.md.
update catalog_image_site_templates set site_id = 'lag-1' where site_id = 'guild-a';
alter table operations alter column site_id set default 'lag-1';
