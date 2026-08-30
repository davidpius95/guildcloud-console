-- Restore the worker's ability to see the operations it has been given.
--
-- THE FAULT THIS FIXES
--
-- Instance creation stopped working in production the moment both workers moved
-- to `worker_token` mode, and did so silently. Last operation executed
-- 2026-08-29 19:18; the two creates after it (22:28 and 23:04) were still
-- `pending`, untouched, nine hours later, with their instances showing
-- `provisioning` to the customer the whole time.
--
-- `claimPendingOperations()` in deploy/site-worker/index.js placed operations
-- through the boundary RPC correctly, then listed them to execute with a plain
-- table read:
--
--     const { data: ops } = await supabase
--       .from("operations")
--       .select(...)
--       .eq("cluster_id", config.clusterId)
--       .in("state", ["pending", "running"])
--
-- The Task 7 boundary leaves `guildcloud_site_worker` with zero table
-- privileges, by design, so that read is denied. The call destructures only
-- `data` and discards `error`, so the denial became an empty array and the
-- worker concluded there was no work to do. Nothing logged.
--
-- Deletions kept working throughout, which is why the outage was not obvious:
-- they go through worker_list_pending_deletions(), a real boundary RPC. Creates
-- were the only path still depending on a table read.
--
-- The damage compounds. place_next_pending_operation() selects
-- `where ... cluster_id is null`, so once an operation has been placed it is
-- invisible to placement forever. An operation placed but never started is
-- therefore orphaned permanently: no worker will claim it, and its capacity
-- reservation leaks until it expires. Every create attempt stranded an
-- instance.
--
-- This is the missing listing, as an RPC. The cluster comes from
-- worker_identities via current_worker_cluster(), never from the caller, so a
-- worker cannot ask for another cluster's work.

create or replace function public.worker_list_cluster_operations(p_limit integer default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_cluster_id text := public.current_worker_cluster();
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode = '22023',
      message = 'p_limit must be between 1 and 100';
  end if;

  -- Oldest first, matching the table read this replaces: an operation that has
  -- been waiting longest is the one most worth picking up, and a stable order
  -- keeps two ticks from fighting over the same head of the queue.
  return coalesce((
    select jsonb_agg(row_to_json(candidate)::jsonb order by candidate.updated_at)
    from (
      select operation.id,
             operation.organization_id,
             operation.instance_id,
             operation.cluster_id,
             operation.site_id,
             operation.kind,
             operation.stages,
             operation.assigned_node,
             operation.storage_id,
             operation.updated_at
      from public.operations as operation
      where operation.cluster_id = v_cluster_id
        and operation.state in ('pending', 'running')
      order by operation.updated_at
      limit p_limit
    ) as candidate
  ), '[]'::jsonb);
end
$$;

comment on function public.worker_list_cluster_operations(integer) is
  'Operations assigned to the calling worker''s cluster and not yet finished. '
  'The cluster is resolved from worker_identities, never supplied by the caller. '
  'Replaces a direct table read that silently returned nothing once the worker '
  'lost table privileges, which broke instance creation in production on '
  '2026-08-29.';

-- PUBLIC first: Postgres grants EXECUTE to PUBLIC on every new function and
-- roles inherit it, so revoking from the role alone leaves it callable.
revoke execute on function public.worker_list_cluster_operations(integer)
  from public, anon, authenticated;
grant execute on function public.worker_list_cluster_operations(integer)
  to guildcloud_site_worker;
