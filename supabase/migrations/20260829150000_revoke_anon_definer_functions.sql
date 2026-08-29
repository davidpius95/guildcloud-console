-- Close three SECURITY DEFINER functions that Supabase's security advisor
-- reports as callable by `anon` — i.e. reachable unauthenticated at
-- /rest/v1/rpc/<name>.
--
-- None of them is called by any application code; the only repository mention is
-- in the generated Supabase types.
--
--   route_operation_by_instance()  returns trigger, and is attached to one
--     trigger. A trigger function does not need EXECUTE granted to anybody in
--     order to fire, so exposing it as an RPC endpoint has no upside. Calling it
--     directly errors anyway, but it should not be in the public API surface.
--
--   begin_instance_operation(uuid, text) / end_instance_operation(uuid)
--     Both check has_org_role() internally, so an anonymous caller cannot
--     actually transition an instance — but they are also dead code, superseded
--     by the atomic request_instance_* RPCs from Task 4, and they are the pair
--     the hardening plan flags as having no tracked migration on `main`
--     (production-only state from commit 242662b). Revoking them shrinks the
--     unauthenticated surface without removing anything that still runs.
--
-- Deliberately a REVOKE and not a DROP: these two exist in production but not in
-- this repository's migration history, so dropping them here would make the
-- repo's schema and production diverge further rather than less. Removing them
-- belongs with Task 1, which reconciles that history.

do $$
declare
  v_signature text;
  v_candidates constant text[] := array[
    'public.begin_instance_operation(uuid, text)',
    'public.end_instance_operation(uuid)',
    'public.route_operation_by_instance()'
  ];
begin
  foreach v_signature in array v_candidates loop
    -- Guarded: begin/end_instance_operation have no migration in this repo, so a
    -- fresh database built from migrations alone will not have them.
    if to_regprocedure(v_signature) is not null then
      -- PUBLIC first. Postgres grants EXECUTE to PUBLIC on every new function and
      -- anon/authenticated inherit it, so revoking only from the named roles
      -- leaves the function callable.
      execute format('revoke execute on function %s from public, anon, authenticated', v_signature);
    end if;
  end loop;
end
$$;
