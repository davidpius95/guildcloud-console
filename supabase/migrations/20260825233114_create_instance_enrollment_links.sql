-- Enrollment is an access credential, so it is bound to a single ready
-- instance rather than stored once on a membership and reused across an
-- organization. A device may receive additional instance links later, but
-- every such link is an explicit, auditable decision.
create table public.instance_enrollment_links (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.memberships(id) on delete cascade,
  instance_id uuid not null references public.instances(id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (membership_id, instance_id)
);

alter table public.instance_enrollment_links enable row level security;

create policy "Members can read their own instance enrollment links"
  on public.instance_enrollment_links for select to authenticated
  using (
    membership_id in (
      select id from public.memberships where user_id = (select auth.uid())
    )
  );

-- The Edge Function uses the service role for writes after it has verified
-- the caller's session and instance entitlement. Do not grant client-side
-- insert/update/delete permissions: a browser must never choose its own VM.

-- Retire the former membership-wide bearer URLs. Their Vault material may
-- remain as unreachable hygiene debt, but no old token can redeem it.
update public.memberships
set enrollment_token = null,
    enrollment_token_expires_at = null
where enrollment_token is not null;

create or replace function public.redeem_instance_enrollment_token(p_token text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link_id uuid;
  v_value text;
begin
  select l.id into v_link_id
  from public.instance_enrollment_links l
  join public.instances i on i.id = l.instance_id
  where l.token = p_token
    and l.expires_at > now()
    and i.state = 'ready';

  if v_link_id is null then
    raise exception 'invalid, expired, or unavailable instance enrollment token';
  end if;

  select decrypted_secret into v_value
  from vault.decrypted_secrets
  where name = 'instance_enrollment_key_' || p_token;

  if v_value is null then
    raise exception 'instance enrollment key not found';
  end if;

  return v_value;
end;
$$;

revoke execute on function public.redeem_instance_enrollment_token(text) from public;
grant execute on function public.redeem_instance_enrollment_token(text) to anon, authenticated, service_role;
