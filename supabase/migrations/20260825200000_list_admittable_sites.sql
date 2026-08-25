-- The console needs to know which sites genuinely exist and whether they are
-- admitting work, so the create wizard stops offering fictional sites like
-- "Abuja 1"/"Amsterdam 1" that no cluster has ever backed. It must NOT get
-- read access to infrastructure_clusters itself: that table carries operator
-- detail (worker ids, heartbeats, failure_reason, per-cluster health) which
-- is squarely in the management zone customers are promised they never see.
--
-- This returns the site-level aggregate only. A site accepts work if any
-- enabled cluster there is admitting.
create or replace function public.list_admittable_sites()
returns table (site_id text, accepting boolean)
language sql
security definer
set search_path to 'public'
as $$
  select
    c.site_id,
    bool_or(c.admission_state = 'open' and c.enabled) as accepting
  from infrastructure_clusters c
  group by c.site_id
  order by c.site_id
$$;

revoke all on function public.list_admittable_sites() from public;
grant execute on function public.list_admittable_sites() to authenticated;
