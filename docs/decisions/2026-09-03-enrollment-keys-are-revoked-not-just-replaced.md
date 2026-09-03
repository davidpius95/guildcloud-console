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

## Addendum — recovering the ids that were never recorded

The decision above only helps keys minted after it. Every older link had a
null id and, since the Tailscale API offers no lookup by secret, looked
permanently unrevokable.

It isn't. The id is the third field of the key itself
(`tskey-auth-<id>-<secret>`), and the secret is already in Vault under
`instance_enrollment_key_<token>`. Verified end to end: both live links
parsed to ids that match keys the API lists, with the right member tags.

`operator_backfill_enrollment_key_ids(p_apply)` does the parse **inside
Postgres**. A script holding the service-role key could have read every
secret out over the wire and parsed a prefix client-side, but that would
pull live tailnet credentials into a terminal, a shell history and
possibly a log, to learn sixteen characters sitting next to them — the
exact shape of the accident that started this work. The secret never
leaves the database; only ids, which are not themselves credentials, are
returned.

`scripts/reconcile-enrollment-keys.mjs` drives it: dry run by default,
`--apply` to write, signing in as a platform operator exactly as
`operator-cleanup.mjs` does. No service-role key.

It deliberately **revokes nothing**. It restores the ability to revoke.
Recording an id is reversible and inert; a bulk revoke of every historical
link would cut off every device still relying on one. Once the ids exist,
the console's own "generate a new link" retires the old key, as it always
claimed to.

Links whose Vault secret is missing, or whose key doesn't parse, are
reported individually as needing a human rather than folded into a total —
"12 recovered" reads as done when three still need the Tailscale console.

Note for whoever runs it: `platform_operators` is currently empty, so every
`operator_*` RPC — including the existing cleanup script — refuses everyone
until a row is added out of band.
