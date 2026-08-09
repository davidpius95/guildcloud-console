-- Follow-up fix: the initial pg_net install (20260808200000) landed in the
-- public schema, which Supabase's own security advisor flags
-- ("Extension in Public"). pg_net doesn't support ALTER EXTENSION ... SET
-- SCHEMA, so the fix is drop + recreate in the correct schema. Nothing
-- depended on pg_net yet (no cron job scheduled before this point), so
-- this is safe.
drop extension pg_net;
create extension pg_net schema extensions;
