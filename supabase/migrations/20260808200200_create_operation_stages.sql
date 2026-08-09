-- Phase 2: replaces operations.stages jsonb with real rows. This is what
-- the console polls to stream progress, and what makes crash-resume
-- mechanical rather than aspirational - the worker's first move on every
-- invocation is finding the first row here that isn't done/skipped and
-- resuming exactly there, never re-running a stage that already committed.
--
-- Fixed enum, not free-form jsonb-with-schema: the master plan's own §5
-- sequence (preflight -> capacity reservation -> durable operation ->
-- site worker -> Proxmox API -> template/cloud-init -> network/access/
-- backup/monitoring attachment -> automated verification -> Ready) is a
-- stated decision, not something a worker should be free to reorder.
--
-- backup_monitoring_attach exists for shape-completeness against §5 but
-- is marked 'skipped' immediately by this phase's worker - real PBS
-- backup attachment is not built yet, deliberately out of scope here.
create table operation_stages (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references operations(id) on delete cascade,
  stage text not null check (stage in (
    'preflight',
    'capacity_reservation',
    'operation_created',
    'site_worker_dispatch',
    'proxmox_api_call',
    'template_cloud_init',
    'network_access_attach',
    'backup_monitoring_attach',
    'automated_verification',
    'ready'
  )),
  status text not null check (status in ('pending', 'active', 'done', 'failed', 'skipped')) default 'pending',
  attempt int not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  detail jsonb not null default '{}',
  error text,
  unique (operation_id, stage)
);

alter table operation_stages enable row level security;

-- Same read model as every other org-scoped table: members of the
-- operation's org can see its stages.
create policy "members can select stages of their org's operations"
  on operation_stages for select
  using (
    exists (
      select 1 from operations o
      where o.id = operation_stages.operation_id
        and is_org_member(o.organization_id)
    )
  );

-- createInstance inserts all 9 stage rows as 'pending' in the same
-- request that creates the operation - same role gate as creating the
-- operation itself. No client update policy: only the Edge Function
-- worker (via its service-role key, which bypasses RLS) ever transitions
-- a stage's status.
create policy "owners/admins can create stages for their org's operations"
  on operation_stages for insert
  with check (
    exists (
      select 1 from operations o
      where o.id = operation_stages.operation_id
        and has_org_role(o.organization_id, array['Owner', 'Admin'])
    )
  );
