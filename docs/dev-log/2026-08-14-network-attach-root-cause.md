# Dev log — `network_access_attach`: three fixes, one real root cause

## Summary

Instance provisioning kept failing at `network_access_attach` (the stage
that installs Tailscale on a new instance and joins it to the tenant
tag). It took three real instances and three commits to find the actual
cause. The first two fixes were real and are worth keeping, but neither
was the root cause — each addressed a symptom that the previous fix
exposed. Recording the whole chain because the wrong-diagnosis part is
the useful lesson.

## The real root cause (found third)

The stage's script began with a guard meant to wait out cloud-init's
`apt` run before installing anything:

```sh
while pgrep -f 'apt|dpkg|dnf|yum|pacman' >/dev/null 2>&1; do sleep 2; done && ...
```

`pgrep -f` matches against the **full command line**, and this guard runs
inside an `sh -c` whose own command line contains the literal text
`apt|dpkg|dnf|yum|pacman`. So the guard matched *itself*. The loop waited
for its own shell to exit, which could only happen after the loop exited.
It never finished — on any instance, ever.

Proven live on a real guest, with no package manager running at all:

```
$ pgrep -af 'apt|dpkg|dnf|yum|pacman'
7076 sh -c while pgrep -f 'apt|dpkg|dnf|yum|pacman' ... tailscale up --authkey ...
$ pgrep -f 'apt|dpkg|dnf|yum|pacman' >/dev/null 2>&1; echo $?
0
```

The only match is pid 7076 — the guard itself. `apt` and `dpkg` had
finished minutes earlier.

**Fix**: bracket character classes, the classic `ps | grep [p]attern`
trick. `[a]pt` matches the literal `apt` in a real apt process's cmdline,
but does not match the literal `[a]pt` in the guard's own cmdline. Also
bounded to ~10 minutes so a genuinely stuck package manager fails
honestly rather than hanging.

Verified live on the same guest, after killing the stale loop:

```
loop exited after 0 iterations, 0s
```

## Why it took three attempts

Each fix removed a layer that was hiding the one beneath it.

**Attempt 1 — the 180s timeout (`aa9787d`).** The stage did a single
blocking `waitForGuestExec(..., 180000)`, and a timeout was fatal. Worse,
every retry re-minted a fresh Tailscale key and kicked a *brand-new*
exec while the previous one was still running — stacking redundant
installs and leaking keys. Changed to kick the exec once, store its pid
in `operation_stages.detail`, and poll it non-blockingly across worker
cycles via the existing `retry_wait` pattern.

*Verified*: instance 2 polled the same `exec_pid` across **63 cycles over
~7 minutes** without failing — well past the old 180s ceiling. Real, and
worth keeping. But the operation still failed, which is what exposed the
next layer.

**Attempt 2 — guest agent losing the pid (`2324c1b`).** Instance 2 died
with `Agent error: PID 1100 does not exist`. Cause confirmed on the VM:
`apt dist-upgrade` upgrades `qemu-guest-agent` itself, restarting its
systemd service (`active since 10:49:02`, two seconds before the
failure) and wiping the agent's exec-tracking table. Our only handle on
the running script vanished, and the poll *threw* rather than reporting
"still running". Fixed by catching that specific loss, dropping the dead
pid, and starting a clean install+join — bounded by a new
`stage_started_at` that survives exec restarts (unlike `exec_started_at`,
which resets each time, and would have let retries extend the stage
forever).

*Verified*: instance 3 hit the identical `PID does not exist` error, and
this time **recovered** — `exec_pid` moved `1119 → 7076`, operation
stayed `running`, `stage_started_at` correctly persisted. Also real, also
worth keeping.

**Attempt 3 — the guard itself (`6ec004b`).** With the operation now
surviving both earlier failure modes, instance 3 kept spinning with no
apt processes left on the box. That's what finally made the self-matching
loop visible: the script wasn't slow, and it wasn't losing its handle —
it could never terminate at all.

## The lesson

The first two fixes each made the system *survive longer* running a
script that could never succeed. Both were verified working against the
exact failure they targeted, and both reported honest-looking green
signals (63 poll cycles with no premature timeout; a clean recovery from
an agent restart). Neither was the bug.

Two things caught it. First, following the operation to its actual
terminal state instead of stopping at "the fix behaved as designed" —
attempt 1 would have looked fully verified if I'd stopped at the resume
behavior. Second, checking the guest directly rather than trusting the
worker's own error message: every symptom pointed at timing (a slow
dracut rebuild, an agent restart), and only `pgrep -af` on the real box
showed the loop matching itself.

## Verified end to end

Instance `worker-fix-verify3`, with all three fixes live:

- Reached `state = ready`, `operations.state = succeeded`.
- `network_access_attach` completed in **11 attempts** — vs. 63 and 77
  attempts ending in failure before.
- Real `private_ip = 100.110.203.31`, real
  `private_hostname = instance-db1528a1.tail345216.ts.net`, real
  `tailscale_device_id`.
- Independently confirmed on the guest itself (not just the DB):
  `systemctl is-active tailscaled` → `active`, and `tailscale ip -4` →
  `100.110.203.31`, matching exactly.

All three test instances were deleted afterward.

## Note on the Deno copy

`supabase/functions/site-worker-guild-a/index.ts` is reference-only
(it can't reach Proxmox's private LAN IP). It had no `pgrep` guard at
all until I mirrored one into it earlier the same day while syncing the
first fix — so I briefly introduced this bug there. Both copies are now
correct and in sync.
