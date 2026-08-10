# Dev log — 2026-08-10: the real reason password reveal never worked, plus UI polish

## The actual root cause of every "reveal shows nothing" report this session

Every earlier explanation this session gave for "I revealed the password and
saw nothing" — component unmount mid-flight, a confusing two-step UI, an
accidental double-click — was wrong, or at best a minor contributing factor.
**The real cause: `vault.delete_secret(uuid)` does not exist in this
Supabase project's Vault extension version.** Only `vault.create_secret`
and `vault.update_secret` do. Every single call to
`reveal_instance_ssh_password` was throwing
`function vault.delete_secret(uuid) does not exist`, and
`revealInstancePassword` in `app/console/instances/actions.ts` collapsed
*any* RPC error into the same `return null` as a genuinely-already-consumed
secret. The UI then showed "Already revealed once and deleted" — which was
a lie every time. Confirmed directly in Postgres logs
(`get_logs` service=postgres) and by finding the secret still sitting,
untouched, in `vault.secrets` days after multiple "reveal" attempts on
different instances.

**Impact:** no password-SSH instance created before this fix ever had its
password successfully shown to anyone, through the real UI, ever.

**Fix:**
- `reveal_instance_ssh_password` now does `delete from vault.secrets where
  id = v_secret_id` directly instead of calling the nonexistent function
  (migration `20260810143110_fix_reveal_password_vault_delete`).
- `revealInstancePassword` now returns `{ value, error }` instead of
  collapsing everything into `string | null`, so a real backend error is
  never again indistinguishable from "already consumed."
- `RevealPasswordButton` surfaces a real error distinctly, with a "safe to
  try again" message and no permanent lockout on transient failures.

**Verified live, for real:** created a fresh instance
(`polish-verify-test`), confirmed the Vault secret existed, revealed it
through the actual UI, saw the real value render, and confirmed via SQL
that the row was actually deleted afterward (`count = 0`). This is the
first time in this project's history that flow has been proven to
actually work end-to-end.

## UI polish pass, per direct user report of cut-off content

`CopyField` (SSH command / private hostname / private IP boxes) used
`overflow-x-auto whitespace-nowrap` in a fixed-width box with only a thin,
easy-to-miss scrollbar — on the instance detail page's narrow sidebar
card, long values (a 44-character SSH command, a Tailscale hostname) were
mostly hidden with no obvious way to see the rest. Switched to
`break-all` wrapping so the full value is always visible without
scrolling. Also found the private-hostname/private-IP pair was laid out
in a 2-column sub-grid inside that same narrow sidebar column, which made
the wrapped text break one character per line — changed to a stacked
single column there (the wider mock-data Connect card, which has room,
was left alone).

## Reveal-password flow rebuilt as a modal

The inline two-step swap (button text changes, then a second button
appears) was easy to miss — a plausible contributor to earlier "nothing
happened" reports even before the Vault bug was found. Rebuilt as a
proper confirm modal, matching the same pattern `DeleteInstanceButton`
already uses, with an explicit "Yes, reveal it now" action and a
`useRef` guard against double-firing.

## Full functional retest this pass, all through the real UI

- Create instance (Standard 1, forced password-SSH since org had no
  keys at the time) → reached `ready`.
- Reveal password → real value shown, Vault row genuinely deleted,
  confirmed via SQL.
- Delete instance → real Proxmox VM destroyed (confirmed via Proxmox API
  404), real DB row removed.
- Verified the create wizard, Guild Instances list, Networking page, and
  Settings page all render without truncation at desktop width.

## Also noted, not fixed this pass

- `Quotas` on the Settings page is still `lib/mock-data.ts` — real usage
  numbers aren't computed anywhere yet. `Team access` on that same page
  *is* real (confirmed live: shows the actual signed-in Owner). The
  Networking page's "Access policy" and "Enrolled devices" sections are
  still mock — no real per-resource grant system or device-enrollment
  model exists yet.
- The Topbar's displayed user name ("Saurabh Rapatwar") is hardcoded mock
  data (`lib/mock-data.ts`'s `currentUser`), unrelated to the actual
  authenticated session (which really is the signed-in Owner,
  `davidpius95@gmail.com` — confirmed via the real Settings/Team-access
  table). Cosmetic, but worth fixing before this could be shown to an
  actual second user.
