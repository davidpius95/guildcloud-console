-- Add instances.updated_at, maintained by trigger.
--
-- `instances` records when a row was created but never when it last changed, so
-- there is no way to ask how long an instance has been in its current state.
-- Anyone trying to answer that reaches for created_at and gets a number that
-- looks like an answer and is not one.
--
-- That has now caused two misdiagnoses. The 2026-08-27 dev-log entry records
-- three instances reported as "stuck deleting for three days" when they had been
-- deleting for about a minute, and warns explicitly about the trap. On
-- 2026-08-29 the same mistake was made again -- four stranded instances were
-- reported as stuck since 08-28 when deletion had been requested that afternoon;
-- 08-28 was their creation date. A warning that has been read and walked into
-- anyway is a missing column, not a reading problem.
--
-- Deliberately NULLABLE, with no backfill. NULL means "this row has not been
-- updated since the column was added" -- which is the truth. Backfilling
-- created_at would reintroduce exactly the failure this fixes: a plausible
-- timestamp that is not the last change, silently mis-answering the question the
-- column exists to answer. The rows resolve themselves the first time anything
-- touches them.
--
-- Callers wanting state age should treat NULL as unknown rather than coalescing
-- it to created_at.

alter table public.instances
  add column if not exists updated_at timestamptz;

comment on column public.instances.updated_at is
  'Last time this row changed, maintained by the touch_instances_updated_at '
  'trigger. NULL means the row has not been updated since the column was added '
  '(2026-08-29) -- treat that as unknown, not as the creation time. Use this '
  'rather than created_at to judge how long an instance has held its state.';

-- SECURITY INVOKER (the default): this only rewrites a field on NEW and touches
-- no tables, so it needs no elevated rights.
create or replace function public.touch_instances_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  -- Only stamp when something actually changed. A no-op UPDATE -- of which this
  -- codebase issues several, e.g. re-setting a state a row already holds --
  -- should not make an instance look freshly touched, or the column becomes as
  -- misleading as created_at was.
  if old is distinct from new then
    new.updated_at := now();
  end if;
  return new;
end
$$;

drop trigger if exists instances_touch_updated_at on public.instances;

create trigger instances_touch_updated_at
  before update on public.instances
  for each row
  execute function public.touch_instances_updated_at();
