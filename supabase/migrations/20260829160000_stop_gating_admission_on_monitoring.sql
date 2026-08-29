-- Stop gating instance admission on a monitoring system that does not exist.
--
-- Found while attempting the Task 12 end-to-end lifecycle test: no instance
-- could be created in production, for any organization, image, or plan.
-- can_provision_instance() returned "No eligible capacity is available" for
-- every combination while both clusters were open, heartbeating, and holding
-- real headroom.
--
-- Cause: both admission paths require `monitoring_healthy`.
--
--   * can_provision_instance()        -- the create wizard's gate
--   * place_next_pending_operation()  -- the RPC that actually places a VM,
--                                        via a 'monitoring_unhealthy' entry in
--                                        its rejection_reasons array
--
-- publish_cluster_snapshot() coerces the column to false unless the worker
-- explicitly sends true, and the worker sends false deliberately: there is no
-- monitoring system in this codebase to query, so it reports the absence
-- honestly rather than asserting a value nobody verified
-- (see deploy/site-worker/index.js, measureBackupHealthy's comment).
--
-- So admission was gated on a capability that does not exist and is correctly
-- reported missing, which makes the product's primary flow permanently
-- unavailable. The honest fix is to stop gating on it -- not to make the worker
-- claim monitoring it does not have, which is exactly the class of untruth
-- Task 3 exists to remove. Task 9 builds real health evidence; when it lands,
-- admission can gate on something that is actually measured.
--
-- private_networking_healthy and backup_healthy are deliberately left in place:
-- both are genuinely measured against real infrastructure.
--
-- Implementation note: these two functions are patched in place from their live
-- definitions rather than rewritten, so every other condition, score weight and
-- reason code stays byte-for-byte identical. Each patch asserts its target text
-- exists before changing anything, and skips with a notice if the function is
-- absent or already patched -- so this is idempotent and safe to re-run.

do $$
declare
  v_def text;
  v_target constant text := 'and monitoring_healthy';
begin
  if to_regprocedure('public.can_provision_instance(text, text, text)') is null then
    raise notice 'can_provision_instance not present; skipping';
    return;
  end if;

  select pg_get_functiondef(to_regprocedure('public.can_provision_instance(text, text, text)')::oid)
    into v_def;

  if position(v_target in v_def) = 0 then
    raise notice 'can_provision_instance already free of the monitoring gate; skipping';
    return;
  end if;

  v_def := replace(
    v_def,
    v_target,
    'and true /* monitoring gate removed: no monitoring system exists yet (Task 9) */'
  );

  execute v_def;
end
$$;

do $$
declare
  v_def text;
  v_target constant text :=
    'case when not scored.monitoring_healthy then ''monitoring_unhealthy'' end,';
begin
  if to_regprocedure('public.place_next_pending_operation(text, timestamptz, text)') is null then
    raise notice 'place_next_pending_operation not present; skipping';
    return;
  end if;

  select pg_get_functiondef(
           to_regprocedure('public.place_next_pending_operation(text, timestamptz, text)')::oid)
    into v_def;

  if position(v_target in v_def) = 0 then
    raise notice 'place_next_pending_operation already free of the monitoring gate; skipping';
    return;
  end if;

  -- Removing the array element is what lifts the gate: eligibility is
  -- `cardinality(rejection_reasons) = 0`, and the surrounding
  -- array_remove(..., null) keeps the shorter array valid.
  v_def := replace(
    v_def,
    v_target,
    '/* monitoring gate removed: no monitoring system exists yet (Task 9) */'
  );

  execute v_def;
end
$$;

-- Both functions are SECURITY DEFINER and were recreated from their own
-- definitions, so search_path, ownership and existing grants are preserved.
-- Reassert the grants anyway: CREATE OR REPLACE keeps them, but being explicit
-- means a future reader does not have to know that to trust this file.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.place_next_pending_operation(text, timestamptz, text) to service_role';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.can_provision_instance(text, text, text) to authenticated';
  end if;
end
$$;

revoke execute on function public.place_next_pending_operation(text, timestamptz, text)
  from public, anon;
