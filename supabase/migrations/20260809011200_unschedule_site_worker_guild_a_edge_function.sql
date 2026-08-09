-- The Edge Function version of the site worker cannot reach Guild-A's
-- private LAN at all (see docs/phase-2/threat-model.md finding #1) and,
-- once the real on-network worker went live, running both caused a real
-- state-corruption bug: two unlocked pollers racing on the same
-- operation. Permanently unscheduled - do not re-add this cron job.
select cron.unschedule('site-worker-guild-a');
