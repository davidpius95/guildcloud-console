-- Makes device self-enrollment links reusable instead of single-use.
--
-- Was: redeem_enrollment_token deleted the vault secret and nulled the
-- membership's enrollment_token on first redemption - a real security
-- choice at the time (same reveal-once discipline as instance passwords),
-- but it meant every "run this on a new device" required going back to
-- the console and regenerating, which made routine multi-device testing
-- and onboarding needlessly slow. User confirmed the tradeoff explicitly
-- (2026-08-25): a persistent link, valid until the member regenerates it
-- or it's revoked, is worth the reduced blast-radius-on-leak.
--
-- Regenerating (requestDeviceEnrollment / enroll-device Edge Function)
-- still overwrites memberships.enrollment_token with a fresh value, so
-- the OLD link stops resolving (no membership row matches it anymore)
-- even though its vault secret is left behind, orphaned but unreachable
-- via any token lookup - same "old value stops working, no active cleanup"
-- pattern already accepted elsewhere in this schema (e.g. reveal-once
-- instance passwords once revealed). A real cleanup job for orphaned
-- enrollment_key_* vault secrets is a separate, not-yet-built hygiene
-- item, not a live credential leak - nothing points at that secret name
-- once the membership row's token no longer equals it.
create or replace function public.redeem_enrollment_token(p_token text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_membership_id uuid;
  v_value text;
begin
  select id into v_membership_id
  from memberships
  where enrollment_token = p_token and enrollment_token_expires_at > now();

  if v_membership_id is null then
    raise exception 'invalid or expired enrollment token';
  end if;

  select decrypted_secret into v_value
  from vault.decrypted_secrets
  where name = 'enrollment_key_' || p_token;

  if v_value is null then
    raise exception 'enrollment key not found';
  end if;

  return v_value;
end;
$$;
