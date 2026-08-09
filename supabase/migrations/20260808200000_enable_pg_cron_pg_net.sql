-- Phase 2: enable the extensions the durable site-worker scheduling depends
-- on. Confirmed live via list_extensions before writing this migration -
-- neither was installed on this project (installed_version: null for both).
--
-- pg_net installed into the "extensions" schema deliberately, not public -
-- Supabase's own advisor flags extensions left in public. (This file
-- reflects the corrected version; the original apply_migration call
-- created pg_net in public and a follow-up migration
-- (20260808200600_recreate_pg_net_in_extensions_schema.sql) dropped and
-- recreated it in the right schema - noted here so the migration history
-- matches what was actually run.)
create extension if not exists pg_cron;
create extension if not exists pg_net schema extensions;
