# Dev log — Phase 4: real invite email

## The fix

`inviteMember` only ever inserted a pending `memberships` row. Nobody was
notified — the invited person only got console access if they happened to
sign up later with the exact same email, matched purely by string equality
(`docs/phase-1/threat-model.md` §5's own documented impersonation gap: any
account holder of that email address, not necessarily the intended person,
could claim the seat).

## What changed

- `inviteMember` now generates a random 7-day-expiring `invite_token`,
  stores it on the `memberships` row, and best-effort calls a new
  `send-invite-email` Edge Function with a real accept link.
- **New Edge Function `send-invite-email`** (`verify_jwt: true`) sends via
  the Resend API using a Vault-stored key — the console app never holds the
  Resend key directly, same boundary as every other secret in this project.
- **New `accept_invite` RPC + `/accept-invite/[token]` page**: the existing
  `link_pending_invites` trigger only fires on a brand-new `auth.users`
  INSERT, so an *already-existing* account clicking the link and signing
  in (not up) would never have linked. The new page handles three real
  cases: invalid/expired token, signed-in user with a matching vs.
  mismatched email (RPC vs. explicit "wrong account" message), and
  not-signed-in (renders the sign-up form with the invited email locked).

## Real bug found and fixed during verification

The Edge Function's error branch hardcoded `status: 502` on every Resend
failure regardless of what Resend actually returned, discarding the real
status code. Fixed to forward `resp.status` — a 403 (validation error) now
surfaces as a 403, not a generic 502, which matters for the next finding.

## Real limitation found during verification (not a bug in this code)

Invited a real second address (`nodebridgeafric@gmail.com`) through the
actual Settings UI. The invite row and token were created correctly, but
the email itself failed to send — confirmed by reading the Next.js dev
server's own log of the `FunctionsHttpError`, then reproducing the exact
Resend response directly via `pg_net` (bypassing the app entirely, to see
Resend's real response body):

```
403 validation_error: "You can only send testing emails to your own email
address (davidpius95@gmail.com). To send emails to other recipients,
please verify a domain at resend.com/domains, and change the `from`
address to an email using this domain."
```

This is Resend's sandbox-domain restriction on `onboarding@resend.dev`,
already flagged as a known limitation in an earlier session's dev-log —
confirmed here, not assumed. To send to real teammates, the account needs
a verified sending domain and a `from` address using it.

**Confirmed the pipeline itself is correct**, not just the code path: sent
a real probe email to the account owner's own address
(`davidpius95@gmail.com`) via the identical `pg_net` call — real `200`,
real Resend message id returned. Vault secret retrieval, the Resend
request shape, and delivery all work; only the sandbox `from`-domain
restriction blocks delivery to other addresses right now.

## Verified live

- Invited `nodebridgeafric@gmail.com` via the real Settings UI → confirmed
  real `invite_token`/`invite_token_expires_at` written to `memberships`
  via SQL (not just trusting the UI's success state).
- Confirmed email send failure and its exact cause (above) rather than
  assuming success.
- Confirmed the underlying send mechanism works via a real successful send
  to a real inbox.
- Visited the real accept link signed in as a *different* account
  (`davidpius95@gmail.com`, the invite was for `nodebridgeafric@gmail.com`)
  → got the real "Wrong account" branch, not a false accept.
- Visited a bogus token → got the real "Invite not found" branch.
- `npx tsc --noEmit && npm run build` clean.

## Explicitly not run live this pass

- The actual sign-up-via-invite-link path (not-signed-in branch → real
  account creation → real `link_pending_invites` trigger firing). This
  reuses `signUpWithEmail`, already proven live elsewhere in this app this
  session, and doing it here would require creating a second real user
  account with no clean teardown path — same blast-radius reasoning used
  for skipping the live `tailscale up` step in Phase 3. Verified by code
  review instead.
- The already-signed-in, matching-email `accept_invite` RPC success path
  (only the mismatch branch was exercised live) — no second real signed-in
  test session was available without creating one. Code reviewed against
  the same SECURITY DEFINER pattern already proven by
  `reveal_instance_ssh_password`/`redeem_enrollment_token`.

## Open item for the user

Real teammate invites won't be delivered until a sending domain is
verified in Resend and `send-invite-email`'s `from` address is updated to
use it — right now delivery only works to the Resend account owner's own
address. Not a code gap, an account-configuration one.
