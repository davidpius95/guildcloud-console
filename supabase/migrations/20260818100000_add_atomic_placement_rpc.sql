create or replace function public.place_next_pending_operation(
  p_worker_cluster_id text,
  p_now timestamptz default clock_timestamp(),
  p_force_cluster_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_operation public.operations%rowtype;
  v_instance public.instances%rowtype;
  v_mode text;
  v_request_vcpu integer;
  v_request_memory_gb numeric;
  v_request_disk_gb numeric;
  v_request_memory_bytes numeric;
  v_request_disk_bytes numeric;
  v_selected_cluster_id text;
  v_selected_node text;
  v_selected_storage_target_id uuid;
  v_selected_storage_id text;
  v_selected_candidate jsonb;
  v_shadow_selected_candidate jsonb;
  v_candidates jsonb;
  v_decision jsonb;
  v_recheck_locked_candidate boolean := false;
  v_locked_candidate_eligible boolean;
begin
  if p_now is null then
    raise exception using errcode = '22023', message = 'Placement time is required.';
  end if;

  if not exists (
    select 1 from public.infrastructure_clusters
    where id = p_worker_cluster_id
  ) then
    raise exception using
      errcode = '22023',
      message = format('Unknown worker cluster: %s.', p_worker_cluster_id);
  end if;

  if p_force_cluster_id is not null and not exists (
    select 1 from public.infrastructure_clusters
    where id = p_force_cluster_id
  ) then
    raise exception using
      errcode = '22023',
      message = format('Unknown forced cluster: %s.', p_force_cluster_id);
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('guildcloud.place_next_pending_operation', 0)
  );

  select mode into strict v_mode
  from public.placement_settings
  where id;

  select operation.*
  into v_operation
  from public.operations operation
  where operation.state = 'pending'
    and operation.kind = 'instance.create'
    and operation.cluster_id is null
  order by operation.started_at, operation.id
  for update skip locked
  limit 1;

  if not found then
    return null;
  end if;

  select instance.*
  into strict v_instance
  from public.instances instance
  where instance.id = v_operation.instance_id;

  select plan.vcpu, plan.memory_gb, plan.disk_gb
  into strict v_request_vcpu, v_request_memory_gb, v_request_disk_gb
  from public.catalog_plans plan
  where plan.id = v_instance.catalog_plan_id;

  v_request_memory_bytes := v_request_memory_gb * 1073741824::numeric;
  v_request_disk_bytes := v_request_disk_gb * 1073741824::numeric;

  drop table if exists pg_temp.guildcloud_placement_candidates;
  create temporary table pg_temp.guildcloud_placement_candidates (
    cluster_id text not null,
    node text not null,
    storage_target_id uuid,
    storage_id text,
    rejection_reasons text[] not null,
    eligible boolean not null,
    score numeric not null,
    memory_baseline numeric not null,
    post_free_memory_bytes numeric not null,
    memory_headroom_ratio numeric not null,
    vcpu_ceiling integer not null,
    post_committed_vcpu numeric not null,
    post_free_vcpu numeric not null,
    vcpu_headroom_ratio numeric not null,
    post_free_storage_bytes numeric not null,
    storage_headroom_ratio numeric not null,
    warm_pool_match boolean not null
  ) on commit drop;

  drop table if exists pg_temp.guildcloud_placement_exclusions;
  create temporary table pg_temp.guildcloud_placement_exclusions (
    cluster_id text not null,
    node text not null,
    storage_target_id uuid not null,
    primary key (cluster_id, node, storage_target_id)
  ) on commit drop;

  loop
    truncate table pg_temp.guildcloud_placement_candidates;

    insert into pg_temp.guildcloud_placement_candidates
      (cluster_id, node, storage_target_id, storage_id, rejection_reasons,
       eligible, score, memory_baseline, post_free_memory_bytes,
       memory_headroom_ratio, vcpu_ceiling, post_committed_vcpu,
       post_free_vcpu, vcpu_headroom_ratio, post_free_storage_bytes,
       storage_headroom_ratio, warm_pool_match)
    with raw_candidates as (
      select
        cluster.id as cluster_id,
        node.node,
        storage.id as storage_target_id,
        storage.storage_id,
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
        node.node = any(coalesce(template.target_nodes, array[]::text[]))
          as template_target_match,
        coalesce(storage.enabled, false) as storage_enabled,
        coalesce(storage.healthy, false) as storage_healthy,
        storage.observed_at as storage_observed_at,
        coalesce(storage.total_bytes, 0) as total_storage_bytes,
        coalesce(storage.used_bytes, 0) as used_storage_bytes,
        coalesce(node_holds.held_memory_bytes, 0) as held_memory_bytes,
        coalesce(node_holds.held_vcpu, 0) as held_vcpu,
        coalesce(storage_holds.held_storage_bytes, 0) as held_storage_bytes,
        exists (
          select 1
          from public.warm_pool_vms warm
          where warm.cluster_id = cluster.id
            and warm.proxmox_node = node.node
            and warm.catalog_image_id = v_instance.catalog_image_id
            and warm.catalog_plan_id = v_instance.catalog_plan_id
            and warm.state = 'warm'
        ) as warm_pool_match
      from public.infrastructure_clusters cluster
      join public.infrastructure_nodes node
        on node.cluster_id = cluster.id
      left join public.catalog_image_cluster_templates template
        on template.cluster_id = cluster.id
       and template.catalog_image_id = v_instance.catalog_image_id
      left join public.infrastructure_storage_targets storage
        on storage.cluster_id = cluster.id
       and (template.storage_id is null or storage.storage_id = template.storage_id)
       and (
         (storage.shared and storage.node is null) or
         (not storage.shared and storage.node = node.node)
       )
      left join lateral (
        select
          coalesce(sum(reservation.memory_gb * 1073741824::numeric), 0)
            as held_memory_bytes,
          coalesce(sum(reservation.vcpu), 0) as held_vcpu
        from public.capacity_reservations reservation
        where reservation.cluster_id = cluster.id
          and reservation.node = node.node
          and (
            reservation.state = 'committed' or
            (reservation.state = 'held' and reservation.expires_at > p_now)
          )
      ) node_holds on true
      left join lateral (
        select
          coalesce(sum(reservation.disk_gb * 1073741824::numeric), 0)
            as held_storage_bytes
        from public.capacity_reservations reservation
        where reservation.cluster_id = cluster.id
          and reservation.storage_id = storage.storage_id
          and (storage.shared or reservation.node = node.node)
          and (
            reservation.state = 'committed' or
            (reservation.state = 'held' and reservation.expires_at > p_now)
          )
      ) storage_holds on storage.id is not null
      where cluster.site_id = v_operation.site_id
    ), capacity_metrics as (
      select
        raw.*,
        greatest(raw.used_memory_bytes, raw.committed_memory_bytes)::numeric
          as memory_baseline,
        raw.total_memory_bytes::numeric -
          greatest(raw.used_memory_bytes, raw.committed_memory_bytes)::numeric -
          raw.held_memory_bytes - v_request_memory_bytes
          as post_free_memory_bytes,
        floor(raw.total_vcpu * 7::numeric / 10)::integer as vcpu_ceiling,
        raw.committed_vcpu::numeric + raw.held_vcpu + v_request_vcpu
          as post_committed_vcpu,
        raw.total_storage_bytes::numeric - raw.used_storage_bytes::numeric -
          raw.held_storage_bytes - v_request_disk_bytes
          as post_free_storage_bytes
      from raw_candidates raw
    ), scored_candidates as (
      select
        metrics.*,
        case
          when metrics.total_memory_bytes > 0
            then metrics.post_free_memory_bytes / metrics.total_memory_bytes
          else 0
        end as memory_headroom_ratio,
        metrics.vcpu_ceiling - metrics.post_committed_vcpu
          as post_free_vcpu,
        case
          when metrics.vcpu_ceiling > 0
            then (metrics.vcpu_ceiling - metrics.post_committed_vcpu) /
              metrics.vcpu_ceiling
          else 0
        end as vcpu_headroom_ratio,
        case
          when metrics.total_storage_bytes > 0
            then metrics.post_free_storage_bytes / metrics.total_storage_bytes
          else 0
        end as storage_headroom_ratio
      from capacity_metrics metrics
    ), evaluated_candidates as (
      select
        scored.*,
        array_remove(array[
          case when not scored.cluster_enabled then 'cluster_disabled' end,
          case when scored.cluster_admission_state <> 'open'
            then 'cluster_admission_closed' end,
          case when scored.worker_heartbeat_at is null
              or scored.worker_heartbeat_at > p_now
              or scored.worker_heartbeat_at < p_now - interval '60 seconds'
            then 'worker_heartbeat_stale' end,
          case when scored.capacity_observed_at is null
              or scored.capacity_observed_at > p_now
              or scored.capacity_observed_at < p_now - interval '60 seconds'
            then 'cluster_capacity_stale' end,
          case when not scored.node_enabled then 'node_disabled' end,
          case when scored.node_admission_state <> 'open'
            then 'node_admission_closed' end,
          case when not scored.node_online then 'node_offline' end,
          case when scored.node_observed_at is null
              or scored.node_observed_at > p_now
              or scored.node_observed_at < p_now - interval '60 seconds'
            then 'node_observation_stale' end,
          case when not scored.template_enabled or not scored.template_tested
            then 'template_unavailable' end,
          case when not scored.template_target_match
            then 'template_target_mismatch' end,
          case when not scored.storage_enabled then 'storage_disabled' end,
          case when not scored.storage_healthy then 'storage_unhealthy' end,
          case when scored.storage_observed_at is null
              or scored.storage_observed_at > p_now
              or scored.storage_observed_at < p_now - interval '60 seconds'
            then 'storage_observation_stale' end,
          case when not scored.private_networking_healthy
            then 'private_networking_unhealthy' end,
          case when not scored.backup_healthy then 'backup_unhealthy' end,
          case when not scored.monitoring_healthy then 'monitoring_unhealthy' end,
          case when scored.post_free_memory_bytes * 10 <
              scored.total_memory_bytes::numeric * 3
            then 'memory_reserve_exceeded' end,
          case when scored.post_committed_vcpu > scored.vcpu_ceiling
            then 'vcpu_limit_exceeded' end,
          case when scored.post_free_storage_bytes * 10 <
              scored.total_storage_bytes::numeric * 3
            then 'storage_reserve_exceeded' end
        ]::text[], null) as rejection_reasons
      from scored_candidates scored
    )
    select
      evaluated.cluster_id,
      evaluated.node,
      evaluated.storage_target_id,
      evaluated.storage_id,
      evaluated.rejection_reasons,
      cardinality(evaluated.rejection_reasons) = 0,
      0.5 * greatest(0, least(1, evaluated.memory_headroom_ratio)) +
        0.25 * greatest(0, least(1, evaluated.vcpu_headroom_ratio)) +
        0.2 * greatest(0, least(1, evaluated.storage_headroom_ratio)) +
        0.05 * case when evaluated.warm_pool_match then 1 else 0 end,
      evaluated.memory_baseline,
      evaluated.post_free_memory_bytes,
      evaluated.memory_headroom_ratio,
      evaluated.vcpu_ceiling,
      evaluated.post_committed_vcpu,
      evaluated.post_free_vcpu,
      evaluated.vcpu_headroom_ratio,
      evaluated.post_free_storage_bytes,
      evaluated.storage_headroom_ratio,
      evaluated.warm_pool_match
    from evaluated_candidates evaluated;

    if v_recheck_locked_candidate then
      select candidate.eligible
      into v_locked_candidate_eligible
      from pg_temp.guildcloud_placement_candidates candidate
      where candidate.cluster_id = v_selected_cluster_id
        and candidate.node = v_selected_node
        and candidate.storage_target_id = v_selected_storage_target_id;

      if coalesce(v_locked_candidate_eligible, false) then
        exit;
      end if;

      insert into pg_temp.guildcloud_placement_exclusions
        (cluster_id, node, storage_target_id)
      values
        (v_selected_cluster_id, v_selected_node, v_selected_storage_target_id)
      on conflict do nothing;
      v_recheck_locked_candidate := false;
    end if;

    select
      candidate.cluster_id,
      candidate.node,
      candidate.storage_target_id,
      candidate.storage_id
    into
      v_selected_cluster_id,
      v_selected_node,
      v_selected_storage_target_id,
      v_selected_storage_id
    from pg_temp.guildcloud_placement_candidates candidate
    where candidate.eligible
      and candidate.storage_target_id is not null
      and not exists (
        select 1
        from pg_temp.guildcloud_placement_exclusions exclusion
        where exclusion.cluster_id = candidate.cluster_id
          and exclusion.node = candidate.node
          and exclusion.storage_target_id = candidate.storage_target_id
      )
      and (
        (p_force_cluster_id is not null and
          candidate.cluster_id = p_force_cluster_id) or
        (p_force_cluster_id is null and v_mode in ('single', 'shadow') and
          candidate.cluster_id = 'guild-a') or
        (p_force_cluster_id is null and v_mode = 'multi')
      )
    order by
      candidate.score desc,
      candidate.cluster_id,
      candidate.node,
      candidate.storage_id
    limit 1;

    if not found then
      v_selected_cluster_id := null;
      v_selected_node := null;
      v_selected_storage_target_id := null;
      v_selected_storage_id := null;
      exit;
    end if;

    perform 1
    from public.infrastructure_nodes node
    where node.cluster_id = v_selected_cluster_id
      and node.node = v_selected_node
    for update;

    perform 1
    from public.infrastructure_storage_targets storage
    where storage.id = v_selected_storage_target_id
    for update;

    v_recheck_locked_candidate := true;
  end loop;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'cluster_id', candidate.cluster_id,
        'node', candidate.node,
        'storage_id', candidate.storage_id,
        'eligible', candidate.eligible,
        'rejection_reasons', to_jsonb(candidate.rejection_reasons),
        'score', candidate.score,
        'score_components', jsonb_build_object(
          'memory_headroom_ratio', candidate.memory_headroom_ratio,
          'vcpu_headroom_ratio', candidate.vcpu_headroom_ratio,
          'storage_headroom_ratio', candidate.storage_headroom_ratio,
          'warm_pool_match', candidate.warm_pool_match
        ),
        'capacity', jsonb_build_object(
          'memory_baseline', candidate.memory_baseline,
          'post_free_memory_bytes', candidate.post_free_memory_bytes,
          'vcpu_ceiling', candidate.vcpu_ceiling,
          'post_committed_vcpu', candidate.post_committed_vcpu,
          'post_free_storage_bytes', candidate.post_free_storage_bytes
        )
      ) order by candidate.cluster_id, candidate.node, candidate.storage_id
    ),
    '[]'::jsonb
  )
  into v_candidates
  from pg_temp.guildcloud_placement_candidates candidate
  where
    (p_force_cluster_id is not null and candidate.cluster_id = p_force_cluster_id) or
    (p_force_cluster_id is null and v_mode = 'single' and
      candidate.cluster_id = 'guild-a') or
    (p_force_cluster_id is null and v_mode in ('shadow', 'multi'));

  if v_selected_cluster_id is not null then
    select jsonb_build_object(
      'cluster_id', candidate.cluster_id,
      'node', candidate.node,
      'storage_id', candidate.storage_id,
      'score', candidate.score,
      'score_components', jsonb_build_object(
        'memory_headroom_ratio', candidate.memory_headroom_ratio,
        'vcpu_headroom_ratio', candidate.vcpu_headroom_ratio,
        'storage_headroom_ratio', candidate.storage_headroom_ratio,
        'warm_pool_match', candidate.warm_pool_match
      )
    )
    into v_selected_candidate
    from pg_temp.guildcloud_placement_candidates candidate
    where candidate.cluster_id = v_selected_cluster_id
      and candidate.node = v_selected_node
      and candidate.storage_target_id = v_selected_storage_target_id;
  end if;

  if v_mode = 'shadow' then
    select jsonb_build_object(
      'cluster_id', candidate.cluster_id,
      'node', candidate.node,
      'storage_id', candidate.storage_id,
      'score', candidate.score,
      'score_components', jsonb_build_object(
        'memory_headroom_ratio', candidate.memory_headroom_ratio,
        'vcpu_headroom_ratio', candidate.vcpu_headroom_ratio,
        'storage_headroom_ratio', candidate.storage_headroom_ratio,
        'warm_pool_match', candidate.warm_pool_match
      )
    )
    into v_shadow_selected_candidate
    from pg_temp.guildcloud_placement_candidates candidate
    where candidate.eligible
    order by
      candidate.score desc,
      candidate.cluster_id,
      candidate.node,
      candidate.storage_id
    limit 1;
  end if;

  v_decision := jsonb_build_object(
    'mode', v_mode,
    'forced', p_force_cluster_id is not null,
    'requesting_worker_cluster_id', p_worker_cluster_id,
    'request', jsonb_build_object(
      'site_id', v_operation.site_id,
      'catalog_image_id', v_instance.catalog_image_id,
      'catalog_plan_id', v_instance.catalog_plan_id,
      'memory_bytes', v_request_memory_bytes,
      'vcpu', v_request_vcpu,
      'disk_bytes', v_request_disk_bytes
    ),
    'candidates', v_candidates,
    'selected_candidate', v_selected_candidate,
    'shadow_selected_candidate', v_shadow_selected_candidate
  );

  if v_selected_cluster_id is null then
    update public.operations
    set failure_reason = 'Waiting for eligible capacity or capability.',
        placement_decision = v_decision
    where id = v_operation.id;

    return null;
  end if;

  update public.operations
  set cluster_id = v_selected_cluster_id,
      assigned_node = v_selected_node,
      storage_id = v_selected_storage_id,
      placement_decision = v_decision,
      failure_reason = null
  where id = v_operation.id;

  update public.instances
  set cluster_id = v_selected_cluster_id,
      proxmox_node = v_selected_node
  where id = v_instance.id;

  insert into public.capacity_reservations
    (operation_id, site_id, cluster_id, node, storage_id, vcpu, memory_gb,
     disk_gb, state, created_at, expires_at)
  values
    (v_operation.id, v_operation.site_id, v_selected_cluster_id,
     v_selected_node, v_selected_storage_id, v_request_vcpu,
     v_request_memory_gb, v_request_disk_gb, 'held', p_now,
     p_now + interval '15 minutes');

  update public.operation_stages
  set status = 'done',
      started_at = coalesce(started_at, p_now),
      finished_at = p_now,
      detail = coalesce(detail, '{}'::jsonb) || jsonb_build_object(
        'cluster_id', v_selected_cluster_id,
        'node', v_selected_node,
        'storage_id', v_selected_storage_id
      )
  where operation_id = v_operation.id
    and stage in ('preflight', 'capacity_reservation');

  return v_operation.id;
end
$$;

revoke all on function public.place_next_pending_operation(text, timestamptz, text)
  from public;
revoke all on function public.place_next_pending_operation(text, timestamptz, text)
  from anon;
revoke all on function public.place_next_pending_operation(text, timestamptz, text)
  from authenticated;
grant execute on function public.place_next_pending_operation(text, timestamptz, text)
  to service_role;
