-- worker_get_operation returned stage NAMES where it meant to return stage ROWS.
--
-- The aggregation aliased the table as `stage`:
--
--     select jsonb_agg(to_jsonb(s) order by s.id)
--     from public.operation_stages as stage
--
-- `operation_stages` has a column called `stage`. When a name could mean either
-- a table alias or a column of that table, Postgres resolves it to the COLUMN.
-- So `to_jsonb(stage)` serialised the text of the stage column, not the row, and
-- the RPC returned:
--
--     ["template_cloud_init", "operation_created", ...]
--
-- instead of the row objects the caller needs. processOneStage then did
--
--     new Map(stages.map((s) => [s.stage, s]))
--
-- where every `s` is a string, so every key was `undefined`, no stage matched
-- STAGE_ORDER, and it returned `no_pending_stage`. The caller treats that as
-- unrecoverable and throws, so the whole worker run exited non-zero -- taking
-- every other operation on that cluster down with it, not just the one.
--
-- This was latent from the day the boundary shipped (20260829120000) and could
-- not be hit, because until 20260830090000 the worker could not list its
-- operations in worker_token mode at all. Fixing the listing surfaced it
-- immediately: the Guild-B worker crash-looped on the first operation it had
-- been able to see in fifteen hours.
--
-- The fix is the alias. `s` cannot be mistaken for a column of this table.
-- Nothing else changes.
--
-- Checked while here: the other `to_jsonb(alias)` sites in this schema alias
-- warm_pool_vms as `vm`, catalog_plans as `plan`,
-- catalog_image_cluster_node_templates as `template`, instances as `instance`
-- and operations as `operation`. None of those tables has a column of that
-- name, so none of them collides. This was the only one.

create or replace function public.worker_get_operation(p_operation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_operation public.operations%rowtype;
  v_instance public.instances%rowtype;
begin
  v_operation := public.assert_worker_owns_operation(p_operation_id);

  if v_operation.instance_id is not null then
    select instance.* into v_instance
    from public.instances as instance
    where instance.id = v_operation.instance_id;

    if found and v_instance.cluster_id is distinct from v_operation.cluster_id then
      raise exception using errcode = '42501',
        message = 'instance cluster does not match operation cluster';
    end if;
  end if;

  return jsonb_build_object(
    'operation', to_jsonb(v_operation),
    'instance', case when v_instance.id is null then null else to_jsonb(v_instance) end,
    -- `s`, not `stage`: see the header. The column would win and this would
    -- serialise stage names instead of stage rows.
    'stages', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.id)
      from public.operation_stages as s
      where s.operation_id = v_operation.id
    ), '[]'::jsonb)
  );
end
$$;

revoke execute on function public.worker_get_operation(uuid) from public, anon, authenticated;
grant execute on function public.worker_get_operation(uuid) to guildcloud_site_worker;
