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

## Follow-up, same day: two defects found while verifying

Verifying the live feature against real production data (throwaway links,
created and deleted, never a customer's token) turned up two things.

**The invalid card returned HTTP 200.** A dead link rendered a correct
page with a success status, which misinforms every non-human that follows
it. The card moved to `not-found.tsx` in the segment and the page now
calls `notFound()`. Next returns 404 for non-streamed responses, so this
is worth re-checking rather than assuming: measured 404 in dev and in
production. `accept-invite` still has the original 200 pattern and was
left alone.

**`CopyField` spilled out of its own container on a narrow screen.** The
wrapper is `rounded-lg` but its children are not, and nothing clipped
them, so the code block's background and the button's corners painted
past the rounded edge; `self-start` also left the divider stopping
mid-field beside a wrapped multi-line value. Fixed with `overflow-hidden`,
`self-stretch`, and dropping the `gap-2` that only exposed the container's
edge between the two halves. Pre-existing and shared - the same field
appears in the Connect modal, the instance detail page, and the password
reveal.

Verified by measurement rather than by eye, at 320px, 375px and desktop:
button overflow 0px, container/code/button heights equal, no horizontal
page scroll. (An early reading did report horizontal scroll; it was taken
mid-reflow right after the viewport changed, and re-measuring at the
settled width showed a clean 0.)

## Follow-up: the lint gate was broken on any machine with worktrees

`npm run check` failed with ~36,000 problems in this checkout, none of
them from the change. `globalIgnores([".next/**"])` is anchored to the
config's own directory, so it ignored the root build output and nothing
else - the three agent worktrees under `.claude/worktrees/` each carry
their own `.next`, ~350MB of generated chunks, and lint walked all of it.
CI never saw this (fresh clone, no worktrees), so the project's own
pre-ship gate was green in CI and unusable locally. Ignores are now
depth-independent (`**/.next/**`) and `.claude/**` is excluded outright.

## Follow-up: the link was broken on macOS the whole time

A customer reported the link "doesn't authenticate or connect the VM".
The link itself was healthy - VM ready, token live, page rendering - and
the shell route served a valid script. The script was the problem.

`tailscale.com/install.sh` does not install anything on a Mac. Its
`appstore` case is two lines:

```
appstore)
        open "https://apps.apple.com/us/app/tailscale/id1475387142"
        ;;
```

It opens a web page and exits 0. The old enrollment script took that
success at face value, ran on to `sudo tailscale up`, hit command-not-
found, and died on `set -e` having connected nothing. Any Mac without the
client already installed got a link that could not work, and said so only
as a shell error.

A second macOS trap sits behind the first: the App Store build keeps its
CLI inside the bundle (`/Applications/Tailscale.app/Contents/MacOS/Tailscale`)
and the standalone build only creates `/usr/local/bin/tailscale` if the
user opts into CLI integration, so `command -v tailscale` finds nothing
even when the client is installed and running.

The script now resolves a CLI by probing those documented locations
instead of trusting PATH, refuses to pretend on macOS (it prints the
install link and exits non-zero), and drops `sudo` on Darwin, where the
client runs in the user's own session and elevating talks to the wrong
daemon. Both branches were exercised on a real Mac: with PATH intact it
resolves the Homebrew CLI, and with PATH emptied it falls back to the app
bundle.

## Follow-up: Windows is served, from its own URL

Previously the page admitted Windows wasn't supported, which was honest
but not useful. `/api/enroll/<token>/windows` now serves PowerShell that
downloads the per-architecture MSI from the `latest` alias on
pkgs.tailscale.com (verified to resolve to a real signed installer,
`application/x-msi`, ~38MB - not assumed), installs it silently, and
authenticates with the same token the POSIX route redeems.

It is a separate URL rather than content negotiation because `irm` and
`curl` send an identical wildcard Accept header; there is nothing to
negotiate on, and a wrong guess hands a Windows box a POSIX script.

Two faults were caught by reading the served bytes rather than the source:
a `#Requires` line that `iex` silently ignores (removed, because it looked
like a guarantee and asserted nothing), and `Test-Path $exe` running when
`$exe` was `$null` - which throws under `ErrorActionPreference = 'Stop'`
and would have aborted on exactly the machines the install branch exists
for. The exe is now resolved by probing `ProgramW6432`, `ProgramFiles`,
`ProgramFiles(x86)` and PATH, before and again after the install.

**The PowerShell has never run on Windows.** There is no Windows machine
here and no PowerShell to parse it with. It is covered by unit tests
asserting the properties that broke the macOS path, and by review, and
that is all - it needs one real run on a real Windows box before anyone
should trust it.

## Follow-up: the page is platform-aware

`/connect/<token>` now detects the platform from the User-Agent and
defaults to that tab, with macOS / Linux / Windows switchable by hand -
links get opened on a phone and forwarded to whoever owns the machine far
more often than a detected-and-locked UI would survive.

## Tests

`tests/enrollment-scripts.test.ts` covers both scripts, including running
the POSIX one through `sh -n`. The scripts run on machines this repo is
never built on, so the properties that caused the real failures are
asserted rather than trusted.

Twice while writing those tests an assertion matched the script's own
explanatory comments instead of its code and passed for the wrong reason.
Both now go through a `codeOnly()` helper that strips comment lines first.
