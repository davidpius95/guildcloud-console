# Dev log — 2026-09-03: the enrollment URL is now pasteable into a browser

## Why this changed

The "Connect this device" modal hands out one string:

```
curl -fsSL https://cloud.guild-technologies.com/api/enroll/<token> | sh
```

That string contains a URL, and people paste URLs into address bars —
especially when they don't want to run a piped shell command they can't
read first. Until today, doing that hit `/api/enroll/<token>` in a browser
and got the raw install script back, which is wrong in two separate ways:

1. **It leaks a live credential into the browser.** The script embeds the
   authkey. Loading it in a tab writes that key into history, the disk
   cache, and the reach of every extension with read access to the page.
2. **It doesn't help.** `Content-Type: text/x-shellscript` either downloads
   an unexplained file or renders a wall of shell. Neither connects
   anything — a browser cannot join a device to the private network, since
   that's an operating-system change only the device's own shell can make.

## What it does now

The same URL serves two audiences by what they ask for. `curl` sends
`Accept: */*` and still gets the script, byte-for-byte unchanged. A browser
sends `Accept: text/html` and is redirected (302) to `/connect/<token>`, a
real page in the auth layout that:

- names the VM the link grants access to, and its expiry date;
- hands back the same command with a copy button, and says plainly where to
  run it (a terminal, on macOS or Linux — Windows isn't supported by this
  command yet);
- warns if the instance isn't Ready yet, rather than letting the command
  fail with a shell error;
- says "this link is invalid or has expired" when it is, instead of a bare
  404 in plain text.

The page **never redeems the token**. It reads a new RPC,
`describe_instance_enrollment_link`, which returns only the VM's display
name, the expiry, and whether the instance is Ready — nothing that could
enroll a device. `redeem_instance_enrollment_token` remains the only path
to the key, and it is still reachable only by something asking for a
script. That split is the whole point: the credential stays in the shell
the person deliberately ran it in.

The RPC is readable by `anon`, matching `get_invite_by_token` — whoever
pastes the link may not be signed in, the unguessable token is itself the
authorization, and it reveals only what the link's owner was already told
when they generated it.

The console modal now offers the bare URL as a second copy field ("Or open
this link in a browser") alongside the command, so the browser path is
discoverable rather than something you have to think to try.

## Files

- `supabase/migrations/20260903060616_describe_instance_enrollment_link.sql` — new
- `app/api/enroll/[token]/route.ts` — content negotiation on `Accept`
- `app/(auth)/connect/[token]/page.tsx` — new
- `components/connect-device-button.tsx` — second copy field
- `lib/supabase/types.ts` — the new RPC's generated shape

## Verification

- `npx tsc --noEmit` — clean.
- `npm run build` — clean; `/connect/[token]` and `/api/enroll/[token]` both
  present in the route table.
- `scripts/check-migrations.sh` — passed.
- `curl -i /api/enroll/<token>` — no redirect, takes the script path.
- `curl -i -H "Accept: text/html" /api/enroll/<token>` — `302` to
  `/connect/<token>`.
- Browser navigation to `/api/enroll/<token>` lands on the rendered page in
  the auth layout; both the valid and the invalid states were rendered and
  read back.

## Production

Applied to `ssbleuvjxlgttlkoancu` on 2026-09-03, registered as
`20260903060616`. The repo file is named to match that version, so a later
`supabase db push` won't try to replay it — worth noting because most
earlier migrations in this repo *don't* line up with their registered
versions (e.g. `20260902110000` in the tree is `20260902001337` in the
database), and each of those would re-apply on a push.

Verified in production, without ever selecting a token out of the table:
both live enrollment links return exactly one fully-populated row through
the new function, and a bogus token returns zero. Grants are
`anon, authenticated, service_role` — no `PUBLIC` — with `search_path`
pinned to `public`.

The security advisor now lists `describe_instance_enrollment_link` under
`anon_security_definer_function_executable`. That is expected and is the
same finding already carried by `get_invite_by_token`,
`redeem_instance_enrollment_token`, and `list_admittable_sites`: a
token-gated lookup has to be callable by someone who isn't signed in, or
it cannot do its job. `20260829143327_revoke_anon_definer_functions` drew
the same line — it revoked `anon` from the definer functions that had no
business being public and left the token-gated ones alone.
