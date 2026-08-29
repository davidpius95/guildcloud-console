-- Baseline: the Phase 1 control-plane schema.
--
-- WHY THIS FILE EXISTS
--
-- Phase 1 built the first control-plane objects directly against the hosted
-- Supabase project (dashboard + MCP), before this repository started tracking
-- migrations. Migration history therefore began *mid-schema*: the oldest
-- tracked migration, 20260808194048, updates `catalog_image_site_templates`,
-- a table nothing in the repository ever created.
--
-- The consequence was that the repository could not rebuild its own database.
-- Applying every tracked migration in order to an empty Postgres failed 29
-- times out of 42, starting at the very first file, because the foundation
-- those migrations alter was only ever present in one live project. Anyone
-- replicating GuildCloud into a new environment -- and any local
-- `supabase db reset` -- hit that wall immediately.
--
-- This file is that missing foundation, recovered from the live control plane
-- (project ssbleuvjxlgttlkoancu) on 2026-08-29 and written to reproduce the
-- objects **as they stood before 20260808194048**, not as they stand today.
-- That distinction matters: later migrations `alter table` these objects with
-- plain `add column` and `drop constraint`, which are not idempotent. A
-- baseline holding the *current* shape would make the rest of the chain fail
-- on its own history. So, deliberately:
--
--   * `operations` omits idempotency_key, instance_id, site_id, current_stage,
--     failure_reason and updated_at (added by 20260808200100), and cluster_id,
--     assigned_node, storage_id and placement_decision (added by
--     20260818090000). Its state default is 'running' and its state check
--     excludes 'pending' -- 20260808200700 and 20260808200100 change both.
--   * `projects` omits slug and tailscale_acl_state, and the projects_slug_key
--     unique constraint (all added by 20260809071505).
--
-- Everything else is the live shape, because no tracked migration alters it.
--
-- On the existing production project this file is a no-op: every statement is
-- guarded (`if not exists`, `create or replace`, or a DO block). It is safe to
-- mark as already-applied there via `supabase migration repair`, and safe to
-- actually run. See docs/REPLICATION.md for where this sits in a from-zero
-- rebuild.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
-- pgcrypto supplies gen_random_uuid(), used as a default across these tables.
-- pg_cron/pg_net are enabled separately by 20260808200000; supabase_vault and
-- uuid-ossp ship enabled on a hosted Supabase project. Only the one this file
-- actually depends on is asserted here.
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  owner_id uuid not null references auth.users(id) on delete restrict,
  -- Phase 1 placeholder only. Real billing is Phase 6; nothing debits this.
  wallet_balance_cents bigint not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.organizations is
  'Customer organizations. wallet_balance_cents is a Phase 1 placeholder column only - real billing/wallet integration is Phase 6 per the master plan, not wired to any payment flow yet.';

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text not null check (role in ('Owner', 'Admin', 'Developer', 'Billing', 'Read-only')),
  device_enrolled boolean not null default false,
  invited_by uuid references auth.users(id),
  invited_at timestamptz,
  joined_at timestamptz,
  last_active_at timestamptz,
  created_at timestamptz not null default now(),
  invited_email text,
  email text,
  tailscale_device_id text,
  enrollment_token text,
  enrollment_token_expires_at timestamptz,
  invite_token text,
  invite_token_expires_at timestamptz,
  constraint memberships_organization_id_user_id_key unique (organization_id, user_id),
  -- A row is either a real user or an outstanding invite; never neither.
  constraint memberships_user_or_email_chk check (user_id is not null or invited_email is not null)
);

comment on table public.memberships is
  'User <-> organization membership with role. role matches the existing TeamMember.role union in lib/types.ts.';

-- Partial uniqueness: a token is unique while it exists, but many rows have none.
create unique index if not exists memberships_enrollment_token_idx
  on public.memberships (enrollment_token) where enrollment_token is not null;
create unique index if not exists memberships_invite_token_idx
  on public.memberships (invite_token) where invite_token is not null;
create unique index if not exists memberships_org_invited_email_uniq
  on public.memberships (organization_id, invited_email)
  where invited_email is not null and user_id is null;

-- NOTE: slug and tailscale_acl_state are added by 20260809071505, not here.
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text not null default '',
  accent text not null default 'lemon' check (accent in ('lemon', 'sky', 'violet', 'amber')),
  created_at timestamptz not null default now()
);

comment on table public.projects is
  'Matches the existing Project type in lib/types.ts. resourceCount/monthlySpend stay computed, not stored - Phase 2/6 concern.';

create table if not exists public.audit_log (
  id bigint generated by default as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id),
  project_id uuid references public.projects(id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.audit_log is
  'Append-only. No client-side insert/update/delete policy exists - the only insert path is the log_audit_event() security definer function, so app code cannot forge or alter the audit trail directly.';

create table if not exists public.access_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  resource_type text not null
    check (resource_type in ('all', 'instance', 'database', 'cluster', 'bucket', 'function')),
  resource_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  constraint access_grants_project_id_membership_id_resource_type_resour_key
    unique (project_id, membership_id, resource_type, resource_id)
);

create table if not exists public.catalog_plans (
  id text primary key,
  name text not null,
  vcpu integer not null,
  memory_gb integer not null,
  disk_gb integer not null,
  hourly_price numeric(10,4) not null,
  monthly_max numeric(10,2) not null,
  note text,
  is_placeholder boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.catalog_plans is
  'is_placeholder=true means this pricing is NOT real - blocked on Master Plan Section 16 capacity-model -> catalogue proposal step, not yet done. Do not treat as real customer-facing pricing until that step completes and this flag is explicitly flipped.';

create table if not exists public.catalog_images (
  id text primary key,
  name text not null,
  version text not null,
  family text not null check (family in ('os', 'solution')),
  recommended boolean not null default false,
  available_sites text[] not null default '{}'::text[],
  created_at timestamptz not null default now()
);

-- NOTE: the Phase 2 and multi-cluster columns are added by 20260808200100 and
-- 20260818090000; the instance_id FK by 20260808200500. See the header.
create table if not exists public.operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  kind text not null,
  resource_name text not null,
  state text not null default 'running'
    constraint operations_state_check
    check (state in ('running', 'succeeded', 'failed', 'cancelled')),
  stages jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

comment on table public.operations is
  'Phase 1 scope: durable state STORAGE only. Idempotency keys, retry classification, and worker-driven execution are explicitly deferred to Phase 2, when real Proxmox site workers exist to actually orchestrate something.';

-- ---------------------------------------------------------------------------
-- Catalogue seed
--
-- The catalogue was seeded straight into the hosted project in Phase 1 (copied
-- from the since-deleted lib/mock-data.ts), so no migration ever created these
-- rows -- yet 20260808200400 and 20260811080000 insert
-- catalog_image_site_templates rows with a foreign key onto catalog_images.
-- Without a seed here, a from-zero rebuild fails on that constraint.
--
-- These are the LIVE values as of 2026-08-29, not the Phase 1 originals: the
-- version corrections (Debian 13, Fedora 43, Rocky 10, AlmaLinux 10) and
-- arch-linux were themselves applied untracked, so the live rows are the only
-- honest record of them. Later migrations upsert over these rows with
-- `on conflict do update`, so seeding the current values is safe.
--
-- is_placeholder stays true on every plan. Per master plan Section 16 this
-- pricing is NOT real and must not be published until a real capacity model
-- produces a catalogue proposal.
-- ---------------------------------------------------------------------------

insert into public.catalog_images (id, name, version, family, recommended, available_sites) values
  ('ubuntu-2404', 'Ubuntu',      '24.04 LTS',        'os',       true,  array['lag-1','abj-1','ams-1']),
  ('debian-12',   'Debian',      '13',               'os',       false, array['lag-1','abj-1']),
  ('fedora-41',   'Fedora',      '43',               'os',       false, array['lag-1']),
  ('rocky-9',     'Rocky Linux', '10',               'os',       false, array['lag-1','abj-1']),
  ('alma-9',      'AlmaLinux',   '10',               'os',       false, array['lag-1','abj-1']),
  ('arch-linux',  'Arch Linux',  'Rolling',          'os',       false, array['lag-1']),
  ('docker',      'Docker',      'on Ubuntu 24.04',  'solution', false, array['lag-1','abj-1']),
  ('wordpress',   'WordPress',   'on Ubuntu 24.04',  'solution', false, array['lag-1'])
on conflict (id) do nothing;

insert into public.catalog_plans (id, name, vcpu, memory_gb, disk_gb, hourly_price, monthly_max, note, is_placeholder) values
  ('std-1', 'Standard 1', 1,  2,  40,  0.0160, 11.52, null,                      true),
  ('std-2', 'Standard 2', 2,  4,  80,  0.0310, 22.32, null,                      true),
  ('std-4', 'Standard 4', 4,  8,  160, 0.0620, 44.64, null,                      true),
  ('std-8', 'Standard 8', 8,  16, 320, 0.1240, 89.28, 'Limited stock at Lagos 1', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- RLS helper functions
--
-- Both are SECURITY DEFINER on purpose: a policy on `memberships` that queried
-- `memberships` would recurse. Defining them out of the policy path breaks that
-- cycle. 20260829100000 repairs their grants if they drift.
-- ---------------------------------------------------------------------------

create or replace function public.is_org_member(p_org_id uuid)
returns boolean
language sql
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.memberships
    where organization_id = p_org_id and user_id = auth.uid()
  );
$$;

create or replace function public.has_org_role(p_org_id uuid, p_roles text[])
returns boolean
language sql
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.memberships
    where organization_id = p_org_id and user_id = auth.uid() and role = any(p_roles)
  );
$$;

-- The only insert path into audit_log. Membership is checked here rather than
-- by a policy, which is why audit_log has no INSERT policy at all.
create or replace function public.log_audit_event(
  p_organization_id uuid,
  p_action text,
  p_project_id uuid default null,
  p_target_type text default null,
  p_target_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id bigint;
begin
  if not public.is_org_member(p_organization_id) then
    raise exception 'not a member of this organization';
  end if;

  insert into public.audit_log (organization_id, actor_id, project_id, action, target_type, target_id, metadata)
  values (p_organization_id, auth.uid(), p_project_id, p_action, p_target_type, p_target_id, p_metadata)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Org/invite lifecycle
-- ---------------------------------------------------------------------------

-- Creating an org must also make its creator a member, or the creator cannot
-- see the row they just created: every SELECT policy goes through membership.
create or replace function public.handle_new_organization()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_owner_email text;
begin
  select au.email into v_owner_email from auth.users au where au.id = new.owner_id;

  insert into public.memberships (organization_id, user_id, role, joined_at, email)
  values (new.id, new.owner_id, 'Owner', now(), v_owner_email);

  perform public.log_audit_event(
    p_organization_id => new.id,
    p_action => 'org.created',
    p_target_type => 'organization',
    p_target_id => new.id::text,
    p_metadata => jsonb_build_object('name', new.name)
  );

  return new;
end;
$$;

-- An invite created before the invitee had an account is matched on signup.
create or replace function public.link_pending_invites()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.memberships
  set user_id = new.id, joined_at = now(), invited_email = null, email = new.email,
      invite_token = null, invite_token_expires_at = null
  where invited_email = new.email and user_id is null;
  return new;
end;
$$;

-- Readable by anon: the invite landing page renders before the invitee signs in.
create or replace function public.get_invite_by_token(p_token text)
returns table(email text, organization_name text)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  return query
  select m.invited_email, o.name
  from memberships m
  join organizations o on o.id = m.organization_id
  where m.invite_token = p_token
    and m.invite_token_expires_at > now()
    and m.user_id is null;
end;
$$;

-- The token alone is not enough: the signed-in email must match the invited
-- one, so a leaked invite link cannot be redeemed by whoever finds it.
create or replace function public.accept_invite(p_token text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_membership_id uuid;
  v_invited_email text;
  v_caller_email text;
begin
  select id, invited_email into v_membership_id, v_invited_email
  from memberships
  where invite_token = p_token and invite_token_expires_at > now() and user_id is null;

  if v_membership_id is null then
    raise exception 'invalid or expired invite';
  end if;

  select email into v_caller_email from auth.users where id = auth.uid();
  if v_caller_email is null or lower(v_caller_email) <> lower(v_invited_email) then
    raise exception 'this invite was sent to a different email address';
  end if;

  update memberships
  set user_id = auth.uid(), joined_at = now(), invited_email = null, email = v_caller_email,
      invite_token = null, invite_token_expires_at = null
  where id = v_membership_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Instance-adjacent helpers
--
-- These reference `instances`, which 20260808200500 creates later. plpgsql
-- bodies are not resolved until first execution, so defining them here is
-- valid; they simply cannot be *called* until that migration has run.
--
-- touch_instances_updated_at() is deliberately absent: 20260829190000 owns it,
-- along with the column it stamps.
-- ---------------------------------------------------------------------------

create or replace function public.begin_instance_operation(p_instance_id uuid, p_state text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org_id uuid;
  v_updated integer;
begin
  if p_state not in ('resizing', 'restoring') then
    raise exception 'unsupported operation state: %', p_state;
  end if;

  select organization_id into v_org_id from instances where id = p_instance_id;
  if v_org_id is null then
    raise exception 'instance not found';
  end if;
  if not public.has_org_role(v_org_id, array['Owner', 'Admin']) then
    raise exception 'not authorized';
  end if;

  update instances set state = p_state
   where id = p_instance_id and state = 'ready';
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.end_instance_operation(p_instance_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org_id uuid;
begin
  select organization_id into v_org_id from instances where id = p_instance_id;
  if v_org_id is null then
    raise exception 'instance not found';
  end if;
  if not public.has_org_role(v_org_id, array['Owner', 'Admin']) then
    raise exception 'not authorized';
  end if;

  update instances set state = 'ready'
   where id = p_instance_id and state in ('resizing', 'restoring');
end;
$$;

create or replace function public.mark_org_instances_ssh_dirty(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_org_member(p_organization_id) then
    raise exception 'not authorized';
  end if;

  update instances
    set ssh_keys_sync_pending = true
    where organization_id = p_organization_id and state = 'ready';
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'on_organization_created') then
    create trigger on_organization_created
      after insert on public.organizations
      for each row execute function public.handle_new_organization();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'on_auth_user_created_link_invites') then
    create trigger on_auth_user_created_link_invites
      after insert on auth.users
      for each row execute function public.link_pending_invites();
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Every table is deny-by-default; each policy below is the entire allowed
-- surface for client roles. The catalogue tables are world-readable on purpose
-- (the signed-out pricing page reads them); nothing client-side may write them.
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.projects enable row level security;
alter table public.audit_log enable row level security;
alter table public.access_grants enable row level security;
alter table public.catalog_plans enable row level security;
alter table public.catalog_images enable row level security;
alter table public.operations enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='organizations' and policyname='members can select their orgs') then
    create policy "members can select their orgs" on public.organizations
      for select using (public.is_org_member(id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='organizations' and policyname='authenticated users can create an org for themselves') then
    create policy "authenticated users can create an org for themselves" on public.organizations
      for insert with check (owner_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='organizations' and policyname='owners can update their org') then
    create policy "owners can update their org" on public.organizations
      for update using (public.has_org_role(id, array['Owner']));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='memberships' and policyname='members can select their org''s memberships') then
    create policy "members can select their org's memberships" on public.memberships
      for select using (public.is_org_member(organization_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='memberships' and policyname='owners/admins can add members') then
    create policy "owners/admins can add members" on public.memberships
      for insert with check (public.has_org_role(organization_id, array['Owner','Admin']));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='memberships' and policyname='owners/admins can update member roles') then
    create policy "owners/admins can update member roles" on public.memberships
      for update using (public.has_org_role(organization_id, array['Owner','Admin']));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='memberships' and policyname='owners/admins can remove members') then
    create policy "owners/admins can remove members" on public.memberships
      for delete using (public.has_org_role(organization_id, array['Owner','Admin']));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='projects' and policyname='members can select org projects') then
    create policy "members can select org projects" on public.projects
      for select using (public.is_org_member(organization_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='projects' and policyname='owners/admins can create projects') then
    create policy "owners/admins can create projects" on public.projects
      for insert with check (public.has_org_role(organization_id, array['Owner','Admin']));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='projects' and policyname='owners/admins can update projects') then
    create policy "owners/admins can update projects" on public.projects
      for update using (public.has_org_role(organization_id, array['Owner','Admin']));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='projects' and policyname='owners/admins can delete projects') then
    create policy "owners/admins can delete projects" on public.projects
      for delete using (public.has_org_role(organization_id, array['Owner','Admin']));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='audit_log' and policyname='members can select org audit log') then
    create policy "members can select org audit log" on public.audit_log
      for select using (public.is_org_member(organization_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='access_grants' and policyname='org members can view access grants') then
    create policy "org members can view access grants" on public.access_grants
      for select using (public.is_org_member(organization_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='access_grants' and policyname='owners/admins can add access grants') then
    create policy "owners/admins can add access grants" on public.access_grants
      for insert with check (public.has_org_role(organization_id, array['Owner','Admin']));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='access_grants' and policyname='owners/admins can revoke access grants') then
    create policy "owners/admins can revoke access grants" on public.access_grants
      for delete using (public.has_org_role(organization_id, array['Owner','Admin']));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='catalog_plans' and policyname='anyone can read catalog plans') then
    create policy "anyone can read catalog plans" on public.catalog_plans
      for select using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='catalog_images' and policyname='anyone can read catalog images') then
    create policy "anyone can read catalog images" on public.catalog_images
      for select using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='operations' and policyname='members can select org operations') then
    create policy "members can select org operations" on public.operations
      for select using (public.is_org_member(organization_id));
  end if;
  -- NOTE: the operations INSERT policy is deliberately NOT created here --
  -- 20260808200150 adds it, and creating it twice fails.
end
$$;

-- ---------------------------------------------------------------------------
-- Grants
--
-- Table privileges come from Supabase's default grants to anon/authenticated;
-- RLS above is what actually constrains them. Function EXECUTE is explicit,
-- because a SECURITY DEFINER function that anon can call is a privilege
-- escalation surface -- see 20260829150000, which revokes exactly that on
-- three functions that had been left open.
-- ---------------------------------------------------------------------------

revoke execute on function public.is_org_member(uuid) from public, anon;
revoke execute on function public.has_org_role(uuid, text[]) from public, anon;
revoke execute on function public.log_audit_event(uuid, text, uuid, text, text, jsonb) from public, anon;
revoke execute on function public.accept_invite(text) from public, anon;
revoke execute on function public.mark_org_instances_ssh_dirty(uuid) from public, anon;
revoke execute on function public.begin_instance_operation(uuid, text) from public, anon, authenticated;
revoke execute on function public.end_instance_operation(uuid) from public, anon, authenticated;
revoke execute on function public.get_invite_by_token(text) from public;

grant execute on function public.is_org_member(uuid) to authenticated, service_role;
grant execute on function public.has_org_role(uuid, text[]) to authenticated, service_role;
grant execute on function public.log_audit_event(uuid, text, uuid, text, text, jsonb) to authenticated, service_role;
grant execute on function public.accept_invite(text) to authenticated, service_role;
grant execute on function public.mark_org_instances_ssh_dirty(uuid) to authenticated, service_role;
-- Deliberately service_role only: these two are called on the server, never by
-- a signed-in browser session. This matches the live grants exactly.
grant execute on function public.begin_instance_operation(uuid, text) to service_role;
grant execute on function public.end_instance_operation(uuid) to service_role;
-- anon needs this one: the invite landing page renders before sign-in.
grant execute on function public.get_invite_by_token(text) to anon, authenticated, service_role;
