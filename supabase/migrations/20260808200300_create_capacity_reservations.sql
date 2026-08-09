-- Phase 2: makes "two concurrent requests can't both claim the last slot"
-- real. A hold, not a commit - expires_at means a crashed worker's claim
-- on RAM expires and frees back rather than leaking capacity forever.
-- Preflight always checks live_node_available - sum(held, unexpired) -
-- requested, never just live_node_available alone.
--
-- Internal implementation table, not exposed to the console UI per this
-- phase's plan - RLS enabled with no policies at all means neither anon
-- nor authenticated can read or write it; only the service-role-key-
-- wielding Edge Function worker (which bypasses RLS) touches this table.
create table capacity_reservations (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references operations(id) on delete cascade,
  site_id text not null,
  node text not null,
  vcpu int not null,
  memory_gb numeric not null,
  disk_gb numeric not null,
  state text not null check (state in ('held', 'committed', 'released')) default 'held',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes')
);

alter table capacity_reservations enable row level security;
