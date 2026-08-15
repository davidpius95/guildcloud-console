-- Warm pool: pre-cloned, pre-booted, pre-enrolled VMs that a create request
-- can claim instead of paying clone + boot + Tailscale enrolment inline.
--
-- Why this exists: measured cold provisioning is 149-222s end to end, and the
-- irreducible part is the guest's own boot (~55s) plus Tailscale registration
-- (89-184s, highly variable). No amount of control-plane tuning removes those,
-- so hitting a 90s target requires the wait to have already happened before
-- the customer asks. Measured with this table in place: 40s.
--
-- Capacity reality (measured 2026-08-15): only ~8.33 GB of cluster RAM remains
-- before the plan's own 30% reserve (§11) trips, and a warm VM holds its full
-- plan RAM while idle. A Standard-2 is 4 GB, so the pool is capped at 1-2 VMs
-- and deliberately covers only the single most common image/plan. A deeper
-- pool would consume the capacity real customer instances need - the pool
-- competes for the scarcest resource on the cluster, so it stays small on
-- purpose, and a create that arrives with the pool empty provisions cold.
create table warm_pool_vms (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  catalog_image_id text not null references catalog_images(id),
  catalog_plan_id text not null references catalog_plans(id),
  proxmox_vmid int not null unique,
  proxmox_node text not null,
  -- Pool-generic identity while unclaimed. Rewritten to the customer's
  -- instance hostname at claim time.
  tailscale_hostname text not null,
  tailscale_device_id text,
  private_ip text,
  -- building: cloned and booting, not yet enrolled.
  -- warm:     enrolled and reachable, claimable.
  -- claimed:  handed to a real instance, no longer pool-owned.
  -- failed:   gave up; swept and rebuilt.
  state text not null default 'building'
    check (state in ('building', 'warm', 'claimed', 'failed')),
  claimed_by_instance_id uuid references instances(id) on delete set null,
  failure_reason text,
  created_at timestamptz not null default now(),
  warmed_at timestamptz,
  claimed_at timestamptz
);

-- The claim path looks up exactly one warm VM matching a request.
create index warm_pool_vms_claimable_idx
  on warm_pool_vms (site_id, catalog_image_id, catalog_plan_id)
  where state = 'warm';

create index warm_pool_vms_state_idx on warm_pool_vms (state);

alter table warm_pool_vms enable row level security;

-- Operator/worker-owned infrastructure, never customer-facing: the pool holds
-- no customer data and is not addressable by tenants. No client policy at all
-- (service role bypasses RLS), matching how the site worker owns its own
-- provisioning state elsewhere.
comment on table warm_pool_vms is
  'Pre-warmed VMs claimable at create time. Worker-owned; no client access.';
