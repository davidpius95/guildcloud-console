-- The enrollment URL is now pasteable into a browser as well as into a
-- terminal, so an anonymous browser needs to know whether a link is still
-- good - without ever touching the credential behind it.
--
-- redeem_instance_enrollment_token stays the only path to the key, and it
-- keeps returning it as text/x-shellscript to a shell. This function is
-- deliberately the boring half: it returns the VM's display name and the
-- expiry, nothing that could enroll a device. A browser page renders it,
-- and a browser page is exactly where a live key must never appear (it
-- would land in history, in the disk cache, and in every extension with
-- read access to the tab).
--
-- Same visibility rule as get_invite_by_token: readable by anon, because
-- whoever pastes the link may not be signed in, and the unguessable token
-- is itself the authorization. It reveals only what the person holding
-- the link was already told when it was generated.
create or replace function public.describe_instance_enrollment_link(p_token text)
returns table(instance_name text, expires_at timestamptz, instance_ready boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select i.name, l.expires_at, i.state = 'ready'
  from public.instance_enrollment_links l
  join public.instances i on i.id = l.instance_id
  where l.token = p_token
    and l.expires_at > now();
end;
$$;

revoke execute on function public.describe_instance_enrollment_link(text) from public;
grant execute on function public.describe_instance_enrollment_link(text) to anon, authenticated, service_role;
