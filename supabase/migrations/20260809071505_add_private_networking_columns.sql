-- Phase 3 Slice 1: real per-instance Tailscale private access. See
-- docs/phase-3/data-model.md and docs/decisions/2026-08-07-tailscale-tenancy-model.md.

alter table instances
  add column private_hostname text,
  add column tailscale_device_id text;

-- slug is a permanent, tag-safe identifier generated once at project
-- creation - never recomputed from the renamable `name` column, since
-- it becomes part of a live Tailscale tag (tag:guildcloud-tenant-<slug>)
-- that the ACL policy references by exact string.
alter table projects
  add column slug text,
  add column tailscale_acl_state text not null default 'pending'
    check (tailscale_acl_state in ('pending', 'applied', 'failed'));

-- Backfill existing projects (checked live: only 2 rows, no name
-- collisions) with a slug derived from their own id, not their name.
update projects set slug = 'project-' || substr(id::text, 1, 8) where slug is null;

alter table projects
  alter column slug set not null,
  add constraint projects_slug_key unique (slug);
