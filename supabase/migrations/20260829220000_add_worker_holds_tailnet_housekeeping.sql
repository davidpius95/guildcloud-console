-- Let a worker ask whether it holds tailnet housekeeping, instead of finding out
-- by being refused.
--
-- Exactly one worker in the tailnet holds this role, so every other cluster's
-- worker was calling worker_get_tailnet_desired_state every cycle and being
-- correctly refused with 42501. The boundary was working; the caller had no way
-- to know the answer in advance, so it guessed and lost, every three minutes:
--
--   {"ok":false,"where":"syncMemberDeviceEnrollment_select",
--    "error":"worker_get_tailnet_desired_state failed: worker does not hold the
--             tailnet housekeeping role"}
--
-- A predictable refusal logged as a failure is worse than noise. It trains
-- whoever reads these logs to skip lines that say ok:false, which is exactly the
-- habit that hides a real one.
--
-- Returning a boolean rather than raising is the whole point: this is the one
-- place where "you do not hold the role" is an answer, not an error. Every other
-- caller keeps assert_worker_tailnet_housekeeper, so the check is still enforced
-- at each privileged RPC and this function grants nothing on its own.
--
-- It resolves the cluster first, so an unknown or revoked worker fails here
-- exactly as it does everywhere else rather than quietly getting `false`. That
-- distinction matters: false means "healthy worker, not the housekeeper", and a
-- revoked worker must not be able to hide behind it.

create or replace function public.worker_holds_tailnet_housekeeping()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_worker_id text := nullif(btrim(coalesce(auth.jwt() ->> 'worker_id', '')), '');
begin
  -- Unknown or revoked workers raise 28000 here, identically to every other
  -- worker_* RPC. Only a valid worker gets a true/false answer.
  perform public.current_worker_cluster();

  return exists (
    select 1 from public.worker_identities as identity
    where identity.worker_id = v_worker_id
      and identity.revoked_at is null
      and identity.tailnet_housekeeping
  );
end
$$;

comment on function public.worker_holds_tailnet_housekeeping() is
  'True when the calling worker holds the tailnet housekeeping role. Lets a '
  'worker skip housekeeping work it would be refused, rather than attempting it '
  'and logging the refusal every cycle. Raises 28000 for an unknown or revoked '
  'worker, so false always means "valid worker, not the housekeeper".';

-- Postgres grants EXECUTE to PUBLIC by default, and anon/authenticated inherit
-- it, so revoking from the role alone would leave this callable by anyone.
revoke execute on function public.worker_holds_tailnet_housekeeping()
  from public, anon, authenticated;
grant execute on function public.worker_holds_tailnet_housekeeping()
  to guildcloud_site_worker;
