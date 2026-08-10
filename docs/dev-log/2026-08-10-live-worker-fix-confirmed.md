# Dev log — 2026-08-10: live worker fix confirmed unattended

## What was asked

After finding that the live `/opt/guildcloud-worker/index.js` on the
Guild-A LXC was missing two fixes already made to the Deno source
(`systemctl enable --now tailscaled` before `tailscale up`, and clearing
a stale `error` column on stage success in `markStage()`), the user
pasted both fixes into the live file and restarted
`guildcloud-worker.timer`. Asked to test that it actually worked.

## Real test, no manual intervention this time

Created a real instance (`live-worker-fix-test`) through the actual
console UI, same as every other test this session — but this time
deliberately did **not** touch the guest or the operation manually at
any point, since the whole point was to prove the live fix works
unattended, not to prove I can still unblock it by hand.

**Result: it reached `ready` cleanly on the first attempt.**
`network_access_attach` completed with no `tailscaled`-not-running error
— confirming the live worker now runs `systemctl enable --now tailscaled`
before `tailscale up`, exactly as the Deno source does. `automated_verification`
finished with `error: null`, confirming the `markStage()` fix clears stale
error text on success rather than leaving whatever the last retry
attempt wrote.

Independently verified via `list_devices` (not the worker's self-report):
device `instance-bd7a1d26`, IP `100.127.27.126` — exact match to
`instances.private_ip` — tagged `tag:guildcloud-tenant` +
`tag:guildcloud-tenant-project-b44c4107`, correct for the real
"Production" project.

## Cleaned up

Deleted the test VM (359058) and its `operations`/`instances` rows. The
Tailscale device itself (`instance-bd7a1d26`) is left for manual deletion
— same standing constraint as every other test device this session
(`manage_keys`-class deletion needs an admin risk level this session
doesn't have).

## Verdict

The live worker no longer needs manual per-instance intervention to reach
`ready`. Both fixes found during the "test every phase end to end" pass
are now confirmed live, not just in source.
