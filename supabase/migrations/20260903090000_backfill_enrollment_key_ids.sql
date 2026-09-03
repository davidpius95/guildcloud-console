-- Recovering the key ids that 20260903074930 started recording, for every
-- link minted before it existed.
--
-- The Tailscale API indexes auth keys by id and offers no lookup by
-- secret, which is why revocation was impossible for older links. But the
-- id does not have to come from the API: it is the third field of the key
-- itself (`tskey-auth-<id>-<secret>`), and the secret is already in Vault
-- under `instance_enrollment_key_<token>`. Verified against two live rows
-- whose parsed ids matched keys listed by the API.
--
-- This runs inside the database on purpose. The alternative - a script
-- holding the service-role key, reading every secret out over the wire to
-- parse a prefix client-side - would pull live tailnet credentials into a
-- terminal, a shell history and possibly a log, to learn sixteen
-- characters that were sitting next to them all along. That is the exact
-- shape of the accident this whole line of work started with. The secret
-- never leaves Postgres; only the id, which is not itself a credential,
-- is ever returned.
--
-- Authority is a row in platform_operators, matching operator-cleanup's
-- posture: no service-role key anywhere near this.
create or replace function public.operator_backfill_enrollment_key_ids(p_apply boolean default false)
returns table(
  link_id uuid,
  instance_name text,
  member_email text,
  key_id text,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_operator() then
    raise exception 'not a platform operator';
  end if;

  create temporary table if not exists _backfill_report (
    link_id uuid,
    instance_name text,
    member_email text,
    key_id text,
    status text
  ) on commit drop;
  delete from _backfill_report;

  insert into _backfill_report
  select
    l.id,
    i.name,
    coalesce(m.email, m.invited_email),
    coalesce(
      l.tailscale_key_id,
      substring((s.decrypted_secret::jsonb ->> 'key') from '^tskey-[a-z]+-([A-Za-z0-9]+)-')
    ),
    case
      when l.tailscale_key_id is not null then 'already recorded'
      when s.decrypted_secret is null then 'no secret in vault - revoke by hand'
      when substring((s.decrypted_secret::jsonb ->> 'key') from '^tskey-[a-z]+-([A-Za-z0-9]+)-') is null
        then 'key did not parse - revoke by hand'
      when p_apply then 'recovered'
      else 'would recover'
    end
  from public.instance_enrollment_links l
  join public.instances i on i.id = l.instance_id
  join public.memberships m on m.id = l.membership_id
  left join vault.decrypted_secrets s
    on s.name = 'instance_enrollment_key_' || l.token;

  if p_apply then
    update public.instance_enrollment_links l
    set tailscale_key_id = r.key_id,
        updated_at = now()
    from _backfill_report r
    where r.link_id = l.id
      and r.status = 'recovered'
      and l.tailscale_key_id is null;
  end if;

  return query
  select r.link_id, r.instance_name, r.member_email, r.key_id, r.status
  from _backfill_report r
  order by r.status, r.instance_name;
end;
$$;

revoke execute on function public.operator_backfill_enrollment_key_ids(boolean) from public, anon;
grant execute on function public.operator_backfill_enrollment_key_ids(boolean) to authenticated;
