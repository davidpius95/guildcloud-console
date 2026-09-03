# 2026-09-03 — Enrollment keys are revoked, not just replaced

## Context

An auth key leaked (into an assistant transcript, while diagnosing an
unrelated report). Containing it exposed that GuildCloud had no way to
revoke one.

`enroll-device` created Tailscale auth keys and never deleted one, at any
call site. Two consequences:

1. **"Generate a new link and retire this one" retired nothing.** It
   minted a new key, wrote a new Vault secret, and upserted the link row.
   The old *token* stopped resolving; the old *key* stayed valid for its
   full 90 days. Anyone who had seen a previous link kept working access.

2. **Removing a member did not revoke their credential.** That path
   deauthorized the member's device and left their enrollment keys live.
   The keys are reusable and pre-authorized, so a removed teammate holding
   their link could enroll a second device. The UI promised "network
   permission and server login revoked together"; for the credential
   itself that was not true.

Nothing stored the key id, so revocation was not merely unimplemented -
it was impossible without it. The API indexes keys by id, not by secret.

## Decision

Store `tailscale_key_id` on `instance_enrollment_links` and revoke through
it at both call sites: when a link is replaced, and when a member is
removed.

Ordering is deliberate. The replacement key is created and the row is
upserted **before** the superseded key is revoked, so a failure between
the two leaves the member with a working link rather than none. Revocation
is best-effort and always logged, never allowed to fail the request: every
call site exists to take access away, and throwing halfway would leave the
caller believing nothing happened when the new state is already written.
On member removal the link rows are deleted regardless of whether
Tailscale co-operated, so the URLs stop serving a key even when
revocation logged a failure.

## Consequences

Rows created before this migration have `tailscale_key_id` null. Their
keys cannot be revoked through the API from a token, and must be deleted
from the Tailscale admin console by hand. `revokeAuthKey` logs that case
explicitly rather than passing silently.

This does not delete devices already enrolled with a revoked key -
deleting an auth key never does. Those are handled by the existing device
revocation path.
