-- Prelude for the full-schema harness (scripts/test-full-schema.sh).
--
-- Unlike the other fixtures in this directory, this one creates **no tables**.
-- That is the whole point of the suite it serves: every table, function, policy
-- and grant under test comes from the real migration chain, applied in filename
-- order to an empty database. A fixture that defined `organizations` here would
-- be a second, drifting definition of the thing being verified -- which is the
-- situation that let the schema diverge from the repository in the first place.
--
-- This file supplies only what a hosted Supabase project provides and a bare
-- Postgres container does not.

-- pgTAP for the contract itself.
create extension if not exists pgtap;

-- The image already ships auth.uid(), auth.role(), auth.email(), the auth.users
-- table, and the anon/authenticated/service_role roles. It does not ship
-- auth.jwt(), which the worker boundary reads for non-subject claims. Same shim
-- as cluster_worker_base.sql, kept identical on purpose.
create schema if not exists auth;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

-- Operator-supplied Vault secrets.
--
-- 20260829230000 refuses to apply while any enabled cluster has no matching
-- Vault secret -- deliberately, so a cluster whose Proxmox token is missing is
-- caught at migration time rather than at 3am. 20260818090000 seeds the
-- guild-a and guild-b cluster rows, so a from-zero rebuild inherits that
-- requirement.
--
-- Seeding stubs here stands in for the operator step that a real rebuild does
-- before `supabase db push` (docs/REPLICATION.md 1.2 and 1.4). The values are
-- deliberately worthless: nothing in this suite authenticates to anything, and
-- a harness that needed a real credential to run would be a harness nobody
-- could run.
do $$
begin
  perform vault.create_secret('not-a-real-token', 'proxmox_guild_a_site_worker_token');
  perform vault.create_secret('not-a-real-token', 'proxmox_guild_b_site_worker_token');
exception
  when unique_violation then null;
end
$$;
