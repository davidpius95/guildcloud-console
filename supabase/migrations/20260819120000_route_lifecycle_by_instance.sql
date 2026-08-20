-- Guild-B's storage is per-node, unlike Guild-A's shared ceph-vm, so an
-- instance's storage target is no longer inferable from its cluster alone -
-- the worker needs it stored, the same way node already is.
alter table public.instances
  add column storage_id text;

-- Lifecycle routing belongs in a trigger, not the app: every insert path
-- for a non-create operation (app/console/instances/actions.ts today,
-- anything else tomorrow) copies cluster_id/assigned_node/storage_id from
-- the instance it targets, and a conflicting supplied cluster is rejected
-- outright. This makes misrouting a resize/snapshot/restore/delete to the
-- wrong cluster impossible from any insert path, rather than something
-- every call site has to remember to get right - and it means
-- app/console/instances/actions.ts needs no change at all for those kinds.
-- Creates are untouched: their cluster_id stays null until
-- place_next_pending_operation() assigns it, which is what makes multi-
-- cluster placement possible in the first place.
create or replace function public.route_operation_by_instance()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_instance public.instances%rowtype;
begin
  if new.kind = 'instance.create' then
    return new;
  end if;

  if new.instance_id is null then
    raise exception using
      errcode = '22023',
      message = format('Operation kind %s requires an instance_id.', new.kind);
  end if;

  select * into v_instance from public.instances where id = new.instance_id;
  if not found then
    raise exception using
      errcode = '22023',
      message = format('Unknown instance: %s.', new.instance_id);
  end if;

  if new.cluster_id is not null and new.cluster_id is distinct from v_instance.cluster_id then
    raise exception using
      errcode = '22023',
      message = format(
        'Operation cluster_id (%s) conflicts with instance %s''s actual cluster (%s).',
        new.cluster_id, new.instance_id, v_instance.cluster_id
      );
  end if;

  new.cluster_id := v_instance.cluster_id;
  new.assigned_node := v_instance.proxmox_node;
  new.storage_id := v_instance.storage_id;
  return new;
end;
$$;

create trigger route_operation_by_instance_trigger
  before insert on public.operations
  for each row
  execute function public.route_operation_by_instance();

-- catalog_image_site_availability(): the customer-facing replacement for
-- reading catalog_image_site_templates directly from actions.ts/queries.ts.
-- catalog_image_cluster_templates is service-role-only (exposing cluster
-- ids to the browser would leak the topology this whole design hides), so
-- this security-definer function is the only way `authenticated` learns
-- "is this image available at this site" without learning which cluster or
-- node would serve it.
--
-- Unions the real cluster-capability signal with the legacy
-- catalog_image_site_templates compatibility path (per
-- docs/superpowers/specs/2026-08-18-multi-cluster-placement-design.md
-- §6.4: "remains readable during migration ... removed only after all
-- callers move"). Every catalog_image_cluster_templates row is currently
-- enabled=false (see the 20260818090000 backfill), so without the legacy
-- union this would return nothing and black-hole the wizard the moment
-- callers switch to it, before a single node has actually been re-tested
-- and enabled under the new schema.
create or replace function public.catalog_image_site_availability()
returns table (catalog_image_id text, site_id text)
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select distinct t.catalog_image_id, c.site_id
  from public.catalog_image_cluster_templates t
  join public.infrastructure_clusters c on c.id = t.cluster_id
  where t.enabled and t.tested_at is not null

  union

  select catalog_image_id, site_id
  from public.catalog_image_site_templates;
$$;

revoke all on function public.catalog_image_site_availability() from public;
grant execute on function public.catalog_image_site_availability() to anon, authenticated, service_role;
