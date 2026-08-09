-- Phase 2: add what Phase 1 explicitly deferred - idempotency, a real
-- pending state (the gap between "operation row created" and "worker
-- picked it up", without which a crashed-before-dispatch operation is
-- indistinguishable from one that never started), and a stage/failure
-- pointer for quick status without joining operation_stages every time.
alter table operations
  add column idempotency_key text not null default gen_random_uuid()::text,
  add column instance_id uuid,
  add column site_id text not null default 'guild-a',
  add column current_stage text,
  add column failure_reason text,
  add column updated_at timestamptz not null default now();

alter table operations drop constraint operations_state_check;
alter table operations add constraint operations_state_check
  check (state in ('pending', 'running', 'succeeded', 'failed', 'cancelled'));

create unique index operations_idempotency_key_idx on operations (idempotency_key);
