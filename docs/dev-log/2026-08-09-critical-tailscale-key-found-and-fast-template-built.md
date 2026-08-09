# Dev log — 2026-08-09: critical exposed Tailscale key found, fast template built

## What was asked

Following the worker-loop speed fix, investigate why guest-agent
readiness still took ~2 minutes per instance, and build a faster
template if the cause was fixable.

## What was found — a critical security issue, not just a speed one

Read the actual rendered cloud-init vendor-data from inside a live
diagnostic clone (`cat /var/lib/cloud/instance/vendor-data.txt`, via
QEMU guest-agent exec — the only way to see this, since no available tool
can read snippet files directly off Proxmox node storage). It contained:

```yaml
package_update: true
packages: [qemu-guest-agent, curl]
runcmd:
  - [ sh, -c, "curl -fsSL https://tailscale.com/install.sh | sh" ]
  - [ systemctl, enable, --now, tailscaled ]
  - [ sh, -c, "tailscale up --auth-key=tskey-auth-kHNZ...4nwHbx6Rv3 --ssh ... || true" ]
```

**A hardcoded, reusable, plaintext Tailscale auth key, applied to every
single clone ever made from this template** — including real customer
instances already created this session. Combined with the already-known
fully-open tailnet ACL (Phase 0 gap G-01), every instance auto-joined the
tailnet with full network access under one shared credential. Flagged
immediately as critical and independent of the speed work; the user was
told to revoke the key in the Tailscale admin console regardless of what
happened to the template — rotating the template doesn't revoke an
already-issued key.

Process evidence for the speed cause, from the same investigation
(`systemctl list-jobs`, `ps aux` on a live guest): `cloud-final.service`
was blocked on `apt-get update`, an `appstreamcli refresh`, and the
Tailscale `curl | sh` install — all synchronous, all network-bound, none
of it customer-facing value. `cloud-init analyze show` confirmed cloud-init's
own real work (disk resize, users, SSH, password) takes only ~14s; the
rest was this.

## Fix built and shipped

Per the user's explicit choice (asked directly, not assumed): remove
Tailscale enrollment from the new template entirely rather than keep it
with the same shared key, since Phase 3 (real per-customer private access)
isn't built yet and carrying the exposure forward into new instances
serves no purpose.

- Full-cloned the template to a new vmid (`9010`,
  `ubuntu-2604-guildvm-template-fast`) — full clone, not linked, since this
  is a permanent new base, not a disposable customer instance.
- Cleared `cicustom` entirely (removes the vendor-data reference in one
  step — this is also the fix for the exposed-key finding, since it's the
  same file).
- Converted to a template, repointed
  `catalog_image_site_templates` at it. Old template (`9000`) left
  untouched as rollback — not deleted.
- **Real permission gap found immediately retesting**: the scoped worker
  token's ACL only covered `/vms/9000`; cloning `9010` failed with a real
  403 (`VM.Clone`) until a matching ACL was added. Worth remembering for
  next time a new template vmid enters rotation.

## Verified live, with real before/after numbers

| | Old template | New template |
|---|---|---|
| Admin + clone + config | ~24.5s | ~16.3s |
| Guest boot → agent ready | ~131s | ~74s |
| **Total** | **~197s (3m17s)** | **~91s (~1m31s)** |

Roughly 2x faster. The remaining ~74s is genuine kernel/systemd/cloud-init
boot time on this hardware — not something a template change alone
shrinks further.

## Explicitly not done, not silently folded in

- The Tailscale key itself has not been confirmed revoked by the user as
  of this writing — that's on them, flagged clearly, not something this
  session could do (no access to their Tailscale admin console).
- Real per-customer private-network enrollment is still Phase 3, not
  built. New instances currently have zero private-network access, which
  is a real capability gap versus a "fixed" state — just a safe one
  compared to the shared-key exposure that existed before.
- Did not investigate whether the same exposed key is baked into the
  Debian/Fedora/Rocky/AlmaLinux templates (9001, 9003, 9004, 9005) — only
  the Ubuntu template (9000/9010) was in scope for this session's actual
  provisioning path. Worth checking separately if those templates are
  ever put into real use.
