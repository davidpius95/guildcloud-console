-- Say which of the two shared-storage conditions actually blocked the create.
--
-- 20260903100000_admission_checks_snippets_storage.sql added the gate: a site
-- is refused unless its snippets store has BOTH >= 1 GiB free AND >= 5% free.
-- The refusal only ever reported the percentage, which is misleading whenever
-- the absolute floor is the binding constraint.
--
-- That is not hypothetical. Fixing the underlying outage on 2026-09-03 meant
-- moving /srv/guild-snippets off the PBS datastore's filesystem onto a volume
-- of its own. The first attempt was 512 MB - a store that holds kilobytes,
-- passed every write probe, and was 100% empty. It still refused every create,
-- and told the operator the storage was "0.0% full": true, and no help at all.
--
-- Only the message changes. The eligibility arithmetic is byte-identical, so
-- this cannot alter which sites were already admitted.

create or replace function public.can_provision_instance(p_site_id text, p_catalog_image_id text, p_catalog_plan_id text)
returns table(eligible boolean, message text)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_mode text := 'single';
  v_request_vcpu integer;
  v_request_memory_gb numeric;
  v_request_disk_gb numeric;
  v_request_memory_bytes numeric;
  v_request_disk_bytes numeric;
  v_template_count integer := 0;
  v_candidate_count integer := 0;
  v_eligible_count integer := 0;
  v_snippets_ok integer := 0;
  v_snippets_checked integer := 0;
  v_snippets_worst numeric;
  -- The absolute free-space figure behind the 1 GiB floor, so the refusal can
  -- distinguish "too small" from "too full".
  v_snippets_worst_free numeric;
  v_snippets_storage text;
  v_blocked_by text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  select plan.vcpu, plan.memory_gb, plan.disk_gb
    into v_request_vcpu, v_request_memory_gb, v_request_disk_gb
  from public.catalog_plans plan
  where plan.id = p_catalog_plan_id;

  if not found then
    eligible := false;
    message := 'This plan is not available.';
    return next;
    return;
  end if;

  select settings.mode
    into v_mode
  from public.placement_settings settings
  where settings.id
  limit 1;

  v_mode := coalesce(v_mode, 'single');
  v_request_memory_bytes := v_request_memory_gb * 1073741824::numeric;
  v_request_disk_bytes := v_request_disk_gb * 1073741824::numeric;

  select count(*)
    into v_template_count
  from public.infrastructure_clusters cluster
  join public.catalog_image_cluster_templates template
    on template.cluster_id = cluster.id
   and template.catalog_image_id = p_catalog_image_id
  where cluster.site_id = p_site_id
    and template.enabled
    and template.tested_at is not null
    and (
      v_mode = 'multi' or
      (v_mode in ('single', 'shadow') and cluster.id = 'guild-a')
    );

  -- Snippet storage headroom, per cluster in scope. A create writes a
  -- cloud-init file here before the VM can boot with its own identity, so
  -- no amount of free VM-disk space substitutes for it.
  --
  -- Two floors, because a byte floor alone does not catch this failure.
  -- guild-snippets reports total-used = 5.1 GiB free while Proxmox reports
  -- avail: 0 for the same storage - total-used counts reserved blocks the
  -- writer may not touch, so it overstates writable space on exactly the
  -- filesystems about to reject writes. Until the worker reports the real
  -- `avail`, the 5% proportional floor is the honest proxy: under 5% free is
  -- at or inside the customary reserve, where a root-squashed NFS client
  -- (which is this case) cannot write. guild-snippets sits at 1.7% free.
  select
    count(*),
    count(*) filter (
      where storage.total_bytes > 0
        and (storage.total_bytes - storage.used_bytes) >= 1073741824::numeric
        and (storage.total_bytes - storage.used_bytes)::numeric / storage.total_bytes >= 0.05
    ),
    min(
      case when storage.total_bytes > 0
        then (storage.total_bytes - storage.used_bytes)::numeric / storage.total_bytes
      end
    ),
    min(storage.total_bytes - storage.used_bytes),
    min(storage.storage_id)
    into v_snippets_checked, v_snippets_ok, v_snippets_worst, v_snippets_worst_free, v_snippets_storage
  from public.infrastructure_clusters cluster
  join public.infrastructure_storage_targets storage
    on storage.cluster_id = cluster.id
   and storage.storage_id = cluster.snippets_storage_id
  where cluster.site_id = p_site_id
    and cluster.snippets_storage_id is not null
    and (
      v_mode = 'multi' or
      (v_mode in ('single', 'shadow') and cluster.id = 'guild-a')
    );

  with raw_candidates as (
    select
      cluster.id as cluster_id,
      node.node,
      cluster.enabled as cluster_enabled,
      cluster.admission_state as cluster_admission_state,
      cluster.worker_heartbeat_at,
      cluster.capacity_observed_at,
      cluster.private_networking_healthy,
      cluster.backup_healthy,
      cluster.monitoring_healthy,
      node.enabled as node_enabled,
      node.admission_state as node_admission_state,
      node.online as node_online,
      node.observed_at as node_observed_at,
      node.total_vcpu,
      node.committed_vcpu,
      node.total_memory_bytes,
      node.used_memory_bytes,
      node.committed_memory_bytes,
      node.vcpu_overcommit_ratio,
      node.memory_reserve_ratio,
      coalesce(template.enabled, false) as template_enabled,
      template.tested_at is not null as template_tested,
      node.node = any(coalesce(template.target_nodes, array[]::text[])) as template_target_match,
      coalesce(storage.enabled, false) as storage_enabled,
      coalesce(storage.healthy, false) as storage_healthy,
      storage.observed_at as storage_observed_at,
      coalesce(storage.total_bytes, 0) as total_storage_bytes,
      coalesce(storage.used_bytes, 0) as used_storage_bytes,
      coalesce(node_holds.held_memory_bytes, 0) as held_memory_bytes,
      coalesce(node_holds.held_vcpu, 0) as held_vcpu,
      coalesce(storage_holds.held_storage_bytes, 0) as held_storage_bytes
    from public.infrastructure_clusters cluster
    join public.infrastructure_nodes node
      on node.cluster_id = cluster.id
    left join public.catalog_image_cluster_templates template
      on template.cluster_id = cluster.id
     and template.catalog_image_id = p_catalog_image_id
    left join public.infrastructure_storage_targets storage
      on storage.cluster_id = cluster.id
     and (template.storage_id is null or storage.storage_id = template.storage_id)
     and (
       (storage.shared and storage.node is null) or
       (not storage.shared and storage.node = node.node)
     )
    left join lateral (
      select
        coalesce(sum(reservation.memory_gb * 1073741824::numeric), 0) as held_memory_bytes,
        coalesce(sum(reservation.vcpu), 0) as held_vcpu
      from public.capacity_reservations reservation
      where reservation.cluster_id = cluster.id
        and reservation.node = node.node
        and (
          reservation.state = 'committed' or
          (reservation.state = 'held' and reservation.expires_at > v_now)
        )
    ) node_holds on true
    left join lateral (
      select coalesce(sum(reservation.disk_gb * 1073741824::numeric), 0) as held_storage_bytes
      from public.capacity_reservations reservation
      where reservation.cluster_id = cluster.id
        and reservation.storage_id = storage.storage_id
        and (storage.shared or reservation.node = node.node)
        and (
          reservation.state = 'committed' or
          (reservation.state = 'held' and reservation.expires_at > v_now)
        )
    ) storage_holds on storage.id is not null
    where cluster.site_id = p_site_id
      and (
        v_mode = 'multi' or
        (v_mode in ('single', 'shadow') and cluster.id = 'guild-a')
      )
  ), evaluated_candidates as (
    select
      *,
      (
        cluster_enabled
        and cluster_admission_state = 'open'
        and worker_heartbeat_at is not null
        and worker_heartbeat_at <= v_now
        and worker_heartbeat_at >= v_now - interval '5 minutes'
        and capacity_observed_at is not null
        and capacity_observed_at <= v_now
        and capacity_observed_at >= v_now - interval '5 minutes'
        and node_enabled
        and node_admission_state = 'open'
        and node_online
        and node_observed_at is not null
        and node_observed_at <= v_now
        and node_observed_at >= v_now - interval '5 minutes'
        and template_enabled
        and template_tested
        and template_target_match
        and storage_enabled
        and storage_healthy
        and storage_observed_at is not null
        and storage_observed_at <= v_now
        and storage_observed_at >= v_now - interval '5 minutes'
        and private_networking_healthy
        and backup_healthy
        and true /* monitoring gate removed: no monitoring system exists yet (Task 9) */
        and (
          (total_memory_bytes::numeric - greatest(used_memory_bytes, committed_memory_bytes)::numeric - held_memory_bytes - v_request_memory_bytes)
          >= total_memory_bytes::numeric * coalesce(memory_reserve_ratio, 0.3)
        )
        and (
          committed_vcpu::numeric + held_vcpu + v_request_vcpu
          <= floor(total_vcpu * coalesce(vcpu_overcommit_ratio, 0.7))::integer
        )
        and (
          (total_storage_bytes::numeric - used_storage_bytes::numeric - held_storage_bytes - v_request_disk_bytes) * 10
          >= total_storage_bytes::numeric * 3
        )
      ) as candidate_eligible
    from raw_candidates
  )
  select
    count(*),
    count(*) filter (where candidate_eligible),
    -- Which gate knocked the candidates out, in the order a human would
    -- want to hear it: infrastructure problems first (nobody can fix those
    -- by choosing a smaller plan), then genuine capacity.
    (array_remove(array[
      case when count(*) filter (where cluster_enabled and cluster_admission_state = 'open') = 0
        then 'site_closed' end,
      case when count(*) filter (
        where worker_heartbeat_at is not null and worker_heartbeat_at >= v_now - interval '5 minutes'
      ) = 0 then 'worker_silent' end,
      case when count(*) filter (where template_enabled and template_tested and template_target_match) = 0
        then 'no_template' end,
      case when count(*) filter (where storage_enabled and storage_healthy) = 0
        then 'storage_unavailable' end,
      case when count(*) filter (where private_networking_healthy) = 0
        then 'private_networking' end,
      case when count(*) filter (where backup_healthy) = 0
        then 'backup_unhealthy' end,
      case when count(*) filter (
        where (total_memory_bytes::numeric - greatest(used_memory_bytes, committed_memory_bytes)::numeric - held_memory_bytes - v_request_memory_bytes)
              >= total_memory_bytes::numeric * coalesce(memory_reserve_ratio, 0.3)
      ) = 0 then 'memory' end,
      case when count(*) filter (
        where committed_vcpu::numeric + held_vcpu + v_request_vcpu
              <= floor(total_vcpu * coalesce(vcpu_overcommit_ratio, 0.7))::integer
      ) = 0 then 'vcpu' end,
      case when count(*) filter (
        where (total_storage_bytes::numeric - used_storage_bytes::numeric - held_storage_bytes - v_request_disk_bytes) * 10
              >= total_storage_bytes::numeric * 3
      ) = 0 then 'disk' end
    ], null))[1]
    into v_candidate_count, v_eligible_count, v_blocked_by
  from evaluated_candidates;

  if v_template_count = 0 then
    eligible := false;
    message := 'No tested template is available at this site for this image yet.';
    return next;
    return;
  end if;

  -- Checked before the capacity verdict on purpose: when the snippet store
  -- is full every candidate is doomed regardless of how much room the VM
  -- disk has, and saying "try a smaller plan" would send the customer round
  -- a loop that cannot end well.
  if v_snippets_checked > 0 and v_snippets_ok = 0 then
    eligible := false;
    -- One gate, two causes. Reporting "N% full" for a store that is simply
    -- too small is what made this unactionable on 2026-09-03: after the
    -- snippets share was moved onto its own volume it read as 0.0% full and
    -- still refused every create, because it could not clear the 1 GiB floor.
    if v_snippets_worst_free is not null and v_snippets_worst_free < 1073741824::numeric then
      message := format(
        'This site cannot create servers right now: its shared storage (%s) has only %s MB free, and every new server needs at least 1 GB there to be prepared. This is ours to fix, not yours - nothing you change about the plan or image will help. Please try again later or contact support.',
        coalesce(v_snippets_storage, 'shared'),
        to_char(v_snippets_worst_free / 1048576::numeric, 'FM999990.0')
      );
    else
      message := format(
        'This site cannot create servers right now: its shared storage (%s) is %s%% full, and every new server needs to write there first. This is ours to fix, not yours - nothing you change about the plan or image will help. Please try again later or contact support.',
        coalesce(v_snippets_storage, 'shared'),
        to_char((1 - coalesce(v_snippets_worst, 0)) * 100, 'FM990.0')
      );
    end if;
    return next;
    return;
  end if;

  if v_candidate_count = 0 or v_eligible_count = 0 then
    eligible := false;
    message := case v_blocked_by
      when 'site_closed' then
        'This site is not accepting new servers right now. Nothing you change about the plan or image will help - please try again later.'
      when 'worker_silent' then
        'This site has stopped reporting in, so we cannot safely place a server on it. This is ours to fix - please try again shortly.'
      when 'no_template' then
        'No tested template is available at this site for this image yet. Try a different image.'
      when 'storage_unavailable' then
        'The storage this image needs is unavailable at this site right now. This is ours to fix, not yours.'
      when 'private_networking' then
        'Private networking is unhealthy at this site, and a server without it would be unreachable. This is ours to fix - please try again shortly.'
      when 'backup_unhealthy' then
        'Backups are unhealthy at this site, so we are not creating servers we could not restore. This is ours to fix - please try again shortly.'
      when 'memory' then
        'This site is out of memory for this plan. A smaller plan may fit, or try again later.'
      when 'vcpu' then
        'This site is out of CPU for this plan. A smaller plan may fit, or try again later.'
      when 'disk' then
        'This site is out of disk for this plan. A smaller plan may fit, or try again later.'
      else
        'No eligible capacity is available for this image and plan right now. Try a smaller plan, a different image, or again later.'
    end;
    return next;
    return;
  end if;

  eligible := true;
  message := 'This image and plan can be provisioned right now.';
  return next;
end
$function$;

revoke execute on function public.can_provision_instance(text, text, text) from public, anon;
grant execute on function public.can_provision_instance(text, text, text) to authenticated;
