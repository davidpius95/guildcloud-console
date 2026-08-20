-- Neither of these existed before: place_next_pending_operation() (added by
-- 20260818100000) reads infrastructure_clusters.worker_heartbeat_at and
-- infrastructure_nodes/infrastructure_storage_targets.observed_at against a
-- 60-second freshness window, but nothing wrote to them - every candidate
-- was stale by construction and the RPC could never actually place
-- anything. These two RPCs are the only way a worker publishes into those
-- tables, both service-role-only.

-- touch_worker_heartbeat: called on a fast, independent interval (see
-- deploy/site-worker/index.js's 20s timer) so it stays fresh through a
-- Proxmox task wait or guest-exec poll that can run well past 60 seconds -
-- those must never make a healthy, working cluster look dead. Does nothing
-- but stamp identity and time: no capacity claim lives here.
create or replace function public.touch_worker_heartbeat(
  p_cluster_id text,
  p_worker_id text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_cluster_id is null or p_worker_id is null then
    raise exception using errcode = '22023', message = 'cluster_id and worker_id are required.';
  end if;

  update public.infrastructure_clusters
  set worker_id = p_worker_id,
      worker_heartbeat_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = p_cluster_id;

  if not found then
    raise exception using
      errcode = '22023',
      message = format('Unknown cluster: %s.', p_cluster_id);
  end if;
end;
$$;

-- publish_cluster_snapshot: the only write path into infrastructure_nodes
-- and infrastructure_storage_targets capacity/health columns. Deliberately
-- narrow:
--   * rejects a snapshot whose embedded cluster_id disagrees with the
--     p_cluster_id argument - a worker cannot publish capacity under
--     another cluster's name even if it somehow held that cluster's
--     service-role key, without this check also being bypassed.
--   * rejects a node or storage_id this cluster has not already been
--     registered with (upsert-if-known, not insert-if-new) - an operator
--     registers topology; a worker only ever reports observed state for
--     rows an operator already created. This is what stops a compromised
--     or misconfigured worker from inventing capacity on a node that was
--     never admitted.
--   * never touches enabled or admission_state on any row - those are
--     operator-only. Raw Proxmox "online" maps to infrastructure_nodes
--     .online, which is intentionally a different field from operator
--     admission: an online-but-paused node is expected and normal.
create or replace function public.publish_cluster_snapshot(
  p_cluster_id text,
  p_snapshot jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_snapshot_cluster_id text;
  v_node jsonb;
  v_storage jsonb;
  v_unknown_node text;
  v_unknown_storage text;
begin
  if p_cluster_id is null then
    raise exception using errcode = '22023', message = 'cluster_id is required.';
  end if;

  if not exists (select 1 from public.infrastructure_clusters where id = p_cluster_id) then
    raise exception using
      errcode = '22023',
      message = format('Unknown cluster: %s.', p_cluster_id);
  end if;

  v_snapshot_cluster_id := p_snapshot ->> 'cluster_id';
  if v_snapshot_cluster_id is distinct from p_cluster_id then
    raise exception using
      errcode = '22023',
      message = format(
        'Snapshot cluster_id (%s) does not match the calling cluster (%s).',
        coalesce(v_snapshot_cluster_id, 'null'), p_cluster_id
      );
  end if;

  select n ->> 'node' into v_unknown_node
  from jsonb_array_elements(coalesce(p_snapshot -> 'nodes', '[]'::jsonb)) n
  where not exists (
    select 1 from public.infrastructure_nodes existing
    where existing.cluster_id = p_cluster_id and existing.node = n ->> 'node'
  )
  limit 1;
  if v_unknown_node is not null then
    raise exception using
      errcode = '22023',
      message = format(
        'Cannot publish capacity for unregistered node %s on cluster %s - register it first.',
        v_unknown_node, p_cluster_id
      );
  end if;

  select s ->> 'storage_id' into v_unknown_storage
  from jsonb_array_elements(coalesce(p_snapshot -> 'storage_targets', '[]'::jsonb)) s
  where not exists (
    select 1 from public.infrastructure_storage_targets existing
    where existing.cluster_id = p_cluster_id
      and existing.storage_id = s ->> 'storage_id'
      and existing.node is not distinct from nullif(s ->> 'node', '')
  )
  limit 1;
  if v_unknown_storage is not null then
    raise exception using
      errcode = '22023',
      message = format(
        'Cannot publish capacity for unregistered storage %s on cluster %s - register it first.',
        v_unknown_storage, p_cluster_id
      );
  end if;

  for v_node in select * from jsonb_array_elements(coalesce(p_snapshot -> 'nodes', '[]'::jsonb))
  loop
    update public.infrastructure_nodes
    set online = coalesce((v_node ->> 'online')::boolean, false),
        total_vcpu = coalesce((v_node ->> 'total_vcpu')::integer, 0),
        committed_vcpu = coalesce((v_node ->> 'committed_vcpu')::integer, 0),
        total_memory_bytes = coalesce((v_node ->> 'total_memory_bytes')::bigint, 0),
        used_memory_bytes = coalesce((v_node ->> 'used_memory_bytes')::bigint, 0),
        committed_memory_bytes = coalesce((v_node ->> 'committed_memory_bytes')::bigint, 0),
        cpu_utilization = coalesce((v_node ->> 'cpu_utilization')::numeric, 0),
        observed_at = clock_timestamp(),
        failure_reason = null
    where cluster_id = p_cluster_id and node = v_node ->> 'node';
  end loop;

  for v_storage in select * from jsonb_array_elements(coalesce(p_snapshot -> 'storage_targets', '[]'::jsonb))
  loop
    update public.infrastructure_storage_targets
    set healthy = true,
        total_bytes = coalesce((v_storage ->> 'total_bytes')::bigint, 0),
        used_bytes = coalesce((v_storage ->> 'used_bytes')::bigint, 0),
        observed_at = clock_timestamp(),
        failure_reason = null
    where cluster_id = p_cluster_id
      and storage_id = v_storage ->> 'storage_id'
      and node is not distinct from nullif(v_storage ->> 'node', '');
  end loop;

  update public.infrastructure_clusters
  set capacity_observed_at = clock_timestamp(),
      private_networking_healthy = coalesce((p_snapshot ->> 'private_networking_healthy')::boolean, false),
      backup_healthy = coalesce((p_snapshot ->> 'backup_healthy')::boolean, false),
      monitoring_healthy = coalesce((p_snapshot ->> 'monitoring_healthy')::boolean, false),
      updated_at = clock_timestamp()
  where id = p_cluster_id;
end;
$$;

revoke all on function public.touch_worker_heartbeat(text, text) from public;
revoke all on function public.touch_worker_heartbeat(text, text) from anon;
revoke all on function public.touch_worker_heartbeat(text, text) from authenticated;
grant execute on function public.touch_worker_heartbeat(text, text) to service_role;

revoke all on function public.publish_cluster_snapshot(text, jsonb) from public;
revoke all on function public.publish_cluster_snapshot(text, jsonb) from anon;
revoke all on function public.publish_cluster_snapshot(text, jsonb) from authenticated;
grant execute on function public.publish_cluster_snapshot(text, jsonb) to service_role;
