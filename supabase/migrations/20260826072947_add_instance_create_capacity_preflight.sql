create or replace function public.can_provision_instance(
  p_site_id text,
  p_catalog_image_id text,
  p_catalog_plan_id text
)
returns table (
  eligible boolean,
  message text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
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
        and monitoring_healthy
        and (
          (total_memory_bytes::numeric - greatest(used_memory_bytes, committed_memory_bytes)::numeric - held_memory_bytes - v_request_memory_bytes) * 10
          >= total_memory_bytes::numeric * 3
        )
        and (
          committed_vcpu::numeric + held_vcpu + v_request_vcpu
          <= floor(total_vcpu * 7::numeric / 10)::integer
        )
        and (
          (total_storage_bytes::numeric - used_storage_bytes::numeric - held_storage_bytes - v_request_disk_bytes) * 10
          >= total_storage_bytes::numeric * 3
        )
      ) as candidate_eligible
    from raw_candidates
  )
  select count(*), count(*) filter (where candidate_eligible)
    into v_candidate_count, v_eligible_count
  from evaluated_candidates;

  if v_template_count = 0 then
    eligible := false;
    message := 'No tested template is available at this site for this image yet.';
    return next;
    return;
  end if;

  if v_candidate_count = 0 or v_eligible_count = 0 then
    eligible := false;
    message := 'No eligible capacity is available for this image and plan right now. Try Standard 1, a different image, or wait for more site capacity.';
    return next;
    return;
  end if;

  eligible := true;
  message := 'This image and plan can be provisioned right now.';
  return next;
end
$$;

revoke all on function public.can_provision_instance(text, text, text) from public;
revoke all on function public.can_provision_instance(text, text, text) from anon;
grant execute on function public.can_provision_instance(text, text, text) to authenticated;
