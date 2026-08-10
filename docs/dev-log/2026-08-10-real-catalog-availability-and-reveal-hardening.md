# Dev log — 2026-08-10: real catalog availability, SSH-key modal, reveal-password hardening

## Real bug: image availability was computed from fictional data

The create-instance wizard's `imageAvailable` check (and each image
card's own "available" flag) used `lib/mock-data.ts`'s `availableSites`
field — fictional data claiming Debian, Fedora, Rocky Linux, AlmaLinux,
Docker, and WordPress are all available at Lagos 1. The real
`catalog_image_site_templates` table has exactly one row:
`ubuntu-2404`/`lag-1`. Every other combination would pass the wizard's
own client-side gate, let the user fill out the entire form, and only
fail at the very last step with "No tested template at this site."

**Fix:** new `getCatalogTemplateAvailability()` query, fetched server-side
in `app/console/instances/new/page.tsx` and passed to the wizard as a real
prop. Both the summary-level `imageAvailable` and each image card's
per-card "No tested template at {site}" note now check this real list.
Verified live: Debian/Fedora/Rocky/AlmaLinux now correctly show "No
tested template at Lagos 1" and are disabled; only Ubuntu 24.04 is
selectable. (Also found the same catalog_plans table already has real
`is_placeholder: true` on every plan — pricing shown is genuine but
explicitly not-yet-finalized business pricing, not fabricated; flagging
this for whoever finalizes real hourly rates, not something to silently
present as final.)

## Real feature: add an SSH key without leaving the wizard

Previously the only way to add a key was linking out to Settings in a new
tab. Built `AddSshKeyModal` — same real `addSshKey` action Settings uses,
opened inline from step 5, stays open after each successful add (so
adding two or three keys in a row doesn't mean reopening it each time),
and the wizard tracks an optimistic local key count so the "password SSH
required" lock unlocks immediately once a key lands, with no page reload.
Verified live end-to-end: added a real key through the modal, watched the
SSH-keys badge flip from "None registered" to "Always on" and the
password-SSH checkbox unlock, in the same render.

## Real bug found from a second user report: one-time password lost with nothing shown

A user reported never seeing a revealed password, yet the instance's
Vault secret had already been consumed (`revealInstancePassword` deletes
it as part of the same call that fetches it). Root cause: there was no
confirmation step before firing the request, and no guard against the
request firing more than once — if the component unmounted mid-flight
(navigation, refresh) after the value was already deleted server-side but
before it rendered client-side, the password is gone for good with
nothing to show. Real-instance impact confirmed: instance "Trying" had a
consumed-but-never-seen secret; fixed the user's immediate access with a
direct password reset via the Proxmox guest agent.

**Fix:** `RevealPasswordButton` now requires an explicit "Yes, reveal it
now" confirm click with an explicit warning ("if you navigate away... it's
gone for good") before the request fires, plus a `useRef` guard so a
single component instance can never fire the reveal request twice
regardless of click-timing races.

## Real feature: Guild Instances list page

(Covered in the prior commit's dev-log — noting here since it's part of
the same real-data-audit pass.) The list page only ever rendered
`lib/mock-data.ts`; real instances never appeared there. Now fetches real
instances for the org, joined with real catalog image/plan data.

## Cleanup found, not yet done

`vault.secrets` has an orphaned `instance_ssh_password_...` row for the
already-deleted `test2` instance (id `80122b57-...`) — the instance row
is gone but its Vault secret never was. Not cleaned up this pass; flagging
for whoever next touches `deleteInstance`/`processPendingInstanceDeletions`
to also delete the instance's own Vault secret (if any) as part of real
teardown, not just the Proxmox VM and Tailscale device.
