-- Cluster-scoped worker RPC boundary (plan Task 7, slice A).
--
-- Before this migration the site worker held SUPABASE_SERVICE_ROLE_KEY and wrote
-- directly to instances/operations/operation_stages. Every existing worker RPC
-- (place_next_pending_operation, publish_cluster_snapshot, touch_worker_heartbeat)
-- also takes the cluster as a *parameter*, so the caller asserts its own identity:
-- the Guild-A worker could pass 'guild-b' and act on the other cluster's rows.
--
-- This introduces:
--   * a non-bypassrls `guildcloud_site_worker` role with EXECUTE-only grants and
--     no table privileges at all;
--   * `worker_identities`, mapping an opaque worker id to exactly one cluster;
--   * `current_worker_cluster()`, which resolves the cluster from the DATABASE
--     using the token's `worker_id` claim. The cluster is never read from the
--     token, so a stolen worker token cannot widen its own scope, and revoking a
--     worker is a single UPDATE rather than a JWT-secret rotation.
--
-- Slice A covers the operation execution path (heartbeat, capacity snapshot,
-- claim, operation read, stage transitions, terminal completion). Deletion
-- reconciliation, SSH-key sync, warm pool, and Tailscale metadata still run on
-- the service-role path and move in slice B; the service-role key cannot be
-- removed from worker configuration until that lands.

-- ---------------------------------------------------------------------------
-- Worker role
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'guildcloud_site_worker') then
    create role guildcloud_site_worker nologin noinherit;
  end if;
end
$$;

-- PostgREST switches into this role when the request's JWT carries
-- `role: guildcloud_site_worker`. Without this grant the switch fails and every
-- worker request is rejected rather than silently falling back to anon.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute 'grant guildcloud_site_worker to authenticator';
  end if;
end
$$;

-- Deliberately no table privileges: the role reaches data only through the
-- SECURITY DEFINER functions granted at the bottom of this file. Revoke the
-- schema-level defaults in case a future GRANT ... ON ALL TABLES runs broadly.
revoke all on all tables in schema public from guildcloud_site_worker;
revoke all on all sequences in schema public from guildcloud_site_worker;
revoke all on all functions in schema public from guildcloud_site_worker;
grant usage on schema public to guildcloud_site_worker;

-- ---------------------------------------------------------------------------
-- Worker identity
-- ---------------------------------------------------------------------------

create table if not exists public.worker_identities (
  worker_id text primary key,
  cluster_id text not null references public.infrastructure_clusters(id),
  description text not null default '',
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

comment on table public.worker_identities is
  'Maps an opaque worker id (the `worker_id` JWT claim) to exactly one cluster. '
  'Authoritative for worker scope: RPCs never trust a cluster supplied by the caller. '
  'Set revoked_at to disable a worker token without rotating the project JWT secret.';

alter table public.worker_identities enable row level security;

-- No policies: unreachable via the Data API by anon/authenticated/worker roles.
-- Only SECURITY DEFINER functions and the postgres/service_role owner read it.
revoke all on table public.worker_identities from anon, authenticated, guildcloud_site_worker;

create index if not exists worker_identities_cluster_idx
  on public.worker_identities (cluster_id)
  where revoked_at is null;

-- Resolves the calling worker's cluster, or raises. STABLE so repeated calls
-- inside one RPC do not re-query. Raises 28000 (invalid_authorization_spec)
-- rather than returning null, so a caller that is not a worker can never fall
-- through into a query that would then match every cluster.
create or replace function public.current_worker_cluster()
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_worker_id text;
  v_cluster_id text;
begin
  v_worker_id := nullif(btrim(coalesce(auth.jwt() ->> 'worker_id', '')), '');
  if v_worker_id is null then
    raise exception using errcode = '28000', message = 'worker identity is required';
  end if;

  select identity.cluster_id into v_cluster_id
  from public.worker_identities as identity
  where identity.worker_id = v_worker_id and identity.revoked_at is null;

  if v_cluster_id is null then
    raise exception using errcode = '28000', message = 'worker identity is not recognized';
  end if;

  return v_cluster_id;
end
$$;

revoke execute on function public.current_worker_cluster() from public, anon, authenticated;
grant execute on function public.current_worker_cluster() to guildcloud_site_worker;

-- Raises unless the calling worker's cluster owns this operation. Every RPC
-- below funnels through it so cluster enforcement cannot be forgotten in one
-- branch: an operation belonging to another cluster is reported as missing
-- rather than as forbidden, so a worker cannot probe for another cluster's ids.
create or replace function public.assert_worker_owns_operation(p_operation_id uuid)
returns public.operations
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_operation public.operations%rowtype;
begin
  select operation.* into v_operation
  from public.operations as operation
  where operation.id = p_operation_id
    and operation.cluster_id = public.current_worker_cluster();

  if not found then
    raise exception using errcode = 'P0002', message = 'operation not found for this cluster';
  end if;

  return v_operation;
end
$$;

revoke execute on function public.assert_worker_owns_operation(uuid) from public, anon, authenticated;
grant execute on function public.assert_worker_owns_operation(uuid) to guildcloud_site_worker;

-- ---------------------------------------------------------------------------
-- Liveness and capacity publication
-- ---------------------------------------------------------------------------

create or replace function public.worker_heartbeat()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cluster_id text := public.current_worker_cluster();
  v_worker_id text := auth.jwt() ->> 'worker_id';
begin
  update public.infrastructure_clusters
  set worker_id = v_worker_id,
      worker_heartbeat_at = now(),
      updated_at = now()
  where id = v_cluster_id;
end
$$;

create or replace function public.worker_publish_snapshot(p_snapshot jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cluster_id text := public.current_worker_cluster();
begin
  -- Reuses the existing, tested publication path. The cluster argument comes
  -- from the identity lookup, never from the worker's own request body.
  perform public.publish_cluster_snapshot(v_cluster_id, p_snapshot);
end
$$;

-- ---------------------------------------------------------------------------
-- Operation claim and read
-- ---------------------------------------------------------------------------

create or replace function public.worker_claim_next_operation()
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cluster_id text := public.current_worker_cluster();
begin
  -- p_force_cluster_id is deliberately not exposed to workers: it exists for
  -- operator-driven placement tests and would otherwise re-open the exact
  -- cross-cluster hole this boundary closes.
  return public.place_next_pending_operation(v_cluster_id, now(), null);
end
$$;

create or replace function public.worker_get_operation(p_operation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
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

    -- An instance whose cluster disagrees with its operation means placement or
    -- a manual fix went wrong. Refuse rather than act on the wrong cluster.
    if found and v_instance.cluster_id is distinct from v_operation.cluster_id then
      raise exception using errcode = '42501',
        message = 'instance cluster does not match operation cluster';
    end if;
  end if;

  return jsonb_build_object(
    'operation', to_jsonb(v_operation),
    'instance', case when v_instance.id is null then null else to_jsonb(v_instance) end,
    'stages', coalesce((
      select jsonb_agg(to_jsonb(stage) order by stage.id)
      from public.operation_stages as stage
      where stage.operation_id = v_operation.id
    ), '[]'::jsonb)
  );
end
$$;

-- ---------------------------------------------------------------------------
-- Stage transitions
-- ---------------------------------------------------------------------------

create or replace function public.worker_start_stage(
  p_operation_id uuid,
  p_stage text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_operation public.operations%rowtype;
begin
  v_operation := public.assert_worker_owns_operation(p_operation_id);

  update public.operation_stages
  set status = 'running',
      attempt = attempt + 1,
      started_at = coalesce(started_at, now())
  where operation_id = v_operation.id and stage = p_stage;

  if not found then
    raise exception using errcode = 'P0002', message = 'stage not found for operation';
  end if;

  update public.operations
  set state = 'running', current_stage = p_stage, updated_at = now()
  where id = v_operation.id;
end
$$;

create or replace function public.worker_complete_stage(
  p_operation_id uuid,
  p_stage text,
  p_status text,
  p_detail jsonb default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_operation public.operations%rowtype;
begin
  if p_status not in ('succeeded', 'failed', 'skipped') then
    raise exception using errcode = '22023', message = 'stage status must be succeeded, failed, or skipped';
  end if;

  v_operation := public.assert_worker_owns_operation(p_operation_id);

  update public.operation_stages
  set status = p_status,
      finished_at = now(),
      detail = coalesce(p_detail, detail),
      error = case when p_status = 'failed' then p_error else null end
  where operation_id = v_operation.id and stage = p_stage;

  if not found then
    raise exception using errcode = 'P0002', message = 'stage not found for operation';
  end if;

  update public.operations set updated_at = now() where id = v_operation.id;
end
$$;

-- ---------------------------------------------------------------------------
-- Terminal completion
-- ---------------------------------------------------------------------------

-- Task 4 left finish_instance_operation without the cluster-ownership check its
-- own specification required, so any service-role caller could finalize either
-- cluster's operations. Enforce it here rather than inside that function so the
-- console's own error paths keep working unchanged.
create or replace function public.worker_finish_operation(
  p_operation_id uuid,
  p_outcome text,
  p_observed jsonb default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_worker_owns_operation(p_operation_id);
  perform public.finish_instance_operation(p_operation_id, p_outcome, p_observed, p_error);
end
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke execute on function public.worker_heartbeat() from public, anon, authenticated;
revoke execute on function public.worker_publish_snapshot(jsonb) from public, anon, authenticated;
revoke execute on function public.worker_claim_next_operation() from public, anon, authenticated;
revoke execute on function public.worker_get_operation(uuid) from public, anon, authenticated;
revoke execute on function public.worker_start_stage(uuid, text) from public, anon, authenticated;
revoke execute on function public.worker_complete_stage(uuid, text, text, jsonb, text) from public, anon, authenticated;
revoke execute on function public.worker_finish_operation(uuid, text, jsonb, text) from public, anon, authenticated;

grant execute on function public.worker_heartbeat() to guildcloud_site_worker;
grant execute on function public.worker_publish_snapshot(jsonb) to guildcloud_site_worker;
grant execute on function public.worker_claim_next_operation() to guildcloud_site_worker;
grant execute on function public.worker_get_operation(uuid) to guildcloud_site_worker;
grant execute on function public.worker_start_stage(uuid, text) to guildcloud_site_worker;
grant execute on function public.worker_complete_stage(uuid, text, text, jsonb, text) to guildcloud_site_worker;
grant execute on function public.worker_finish_operation(uuid, text, jsonb, text) to guildcloud_site_worker;

-- The worker role must never reach the underlying primitives directly: those
-- still take a caller-supplied cluster id and are the hole this boundary closes.
--
-- Revoking from the role alone is not enough. Postgres grants EXECUTE to PUBLIC
-- by default on every new function, and a role inherits PUBLIC, so a role-level
-- REVOKE leaves the function callable. Revoke PUBLIC explicitly, then restore
-- the one grant the control plane actually needs.
revoke execute on function public.place_next_pending_operation(text, timestamptz, text)
  from public, anon, authenticated, guildcloud_site_worker;
revoke execute on function public.publish_cluster_snapshot(text, jsonb)
  from public, anon, authenticated, guildcloud_site_worker;
revoke execute on function public.finish_instance_operation(uuid, text, jsonb, text)
  from public, anon, authenticated, guildcloud_site_worker;

-- The console and the not-yet-migrated worker paths still reach these through
-- the service role; slice B removes the worker's half of that.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.place_next_pending_operation(text, timestamptz, text) to service_role';
    execute 'grant execute on function public.publish_cluster_snapshot(text, jsonb) to service_role';
    execute 'grant execute on function public.finish_instance_operation(uuid, text, jsonb, text) to service_role';
  end if;
end
$$;
