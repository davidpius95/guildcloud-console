-- "Generate a new link and retire this one" never retired anything.
--
-- enroll-device minted a fresh Tailscale auth key, wrote a new Vault
-- secret, and upserted the link row - so the old *token* stopped
-- resolving - but the old *key* stayed valid in Tailscale for its full 90
-- days. Anyone who had seen a previous link kept working tailnet access
-- until expiry. The same hole sat behind member removal: that path
-- deauthorizes the member's device and leaves their enrollment keys live,
-- so a removed teammate holding their old link could re-enroll.
--
-- Revoking a key needs its id, and nothing was storing it. This column is
-- the missing half. Nullable because every row that predates it has a key
-- whose id was never recorded and now cannot be recovered from the API by
-- token - those are revoked by hand from the Tailscale admin console.
alter table public.instance_enrollment_links
  add column if not exists tailscale_key_id text;

comment on column public.instance_enrollment_links.tailscale_key_id is
  'Tailscale auth key id backing this link, so replacing or revoking the link can revoke the key. Null for rows created before 2026-09-03.';
