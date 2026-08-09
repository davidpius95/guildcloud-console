-- Schedules the Guild-A site-worker Edge Function every 20 seconds via
-- pg_cron -> pg_net. Uses the publishable/anon key (safe to embed - it's
-- meant to be public-facing by design, unlike the service-role key) just
-- to satisfy the function's verify_jwt check; the function itself uses
-- its own auto-injected SUPABASE_SERVICE_ROLE_KEY for all real writes.
select cron.schedule(
  'site-worker-guild-a',
  '20 seconds',
  $$
  select net.http_post(
    url := 'https://ssbleuvjxlgttlkoancu.supabase.co/functions/v1/site-worker-guild-a',
    headers := jsonb_build_object(
      'Authorization', 'Bearer sb_publishable_t_WWRLE-RXN8Lu7Pc8-0Cw_HgHE2OGY',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
