# 2026-08-07 — Tailscale ACL: zone tags applied, moved under GitOps

## What changed

1. **Read the master plan's exact §6 and §17 text from the live docx** before
   designing anything, per direct instruction — not from memory or the
   Phase 0 summary.
2. **Wrote a Decision Record** (`docs/decisions/2026-08-07-tailscale-tenancy-model.md`)
   proposing a tag-based tenancy model mapped to §6's zone table
   (Management/Tenant/Backup/Future edge), classifying all 27 tailnet
   devices, and explicitly flagging what couldn't be decided without the
   user (device classification, gap G-06).
3. **Asked before touching the live network** — 4 targeted questions on the
   ambiguous parts (G-06's external SSH grant, `podA`–E/`fleetbase`/
   `gean-devnet`/`usher-node` classification, `kuma`'s role, go/no-go).
4. **Built a GitOps scaffold** (`infra/tailscale/policy.hujson`,
   `.github/workflows/tailscale-acl.yml`, `infra/tailscale/README.md`) per
   the user's mid-turn request — the policy is now version-controlled,
   validated on PR, applied on merge to `main`, using Tailscale's own
   `gitops-acl-action`.
5. **Bootstrapped the policy live** (one direct API apply, since the
   workflow's GitHub secrets aren't configured yet) and **tagged 16
   devices**: 5 Proxmox nodes + `proxmox-mcp` + `GL-MT6000` + `kuma` +
   `podB`/`C`/`D`/`E` → `tag:guildcloud-mgmt`; David's 4 devices →
   `tag:operator`.
6. **Re-read live state after applying** — confirmed the ACL and all 16
   device tags match intent before declaring this done.
7. Updated `docs/phase-0/gap-register.md`: G-01 downgraded Critical → Medium
   (scaffolding exists; real tenant isolation is still Phase 3 work). G-06
   marked as an explicit, acknowledged decision rather than a silent
   carry-forward.

## Why

Direct instruction: "always check our plan for every architecture." The plan
frames the Tailscale tenancy model as an explicit decision to "choose and
document... after validating commercial and isolation constraints" (§17) —
not something to silently patch. Given this tailnet also carries real
personal/non-GuildCloud traffic (jellyfin, coolify, homeassistant) and has no
real customer identity yet to isolate from, a full lockdown today would have
broken working things for no real security gain — so the change was scoped
additively: new zone scaffolding added, nothing that worked before was
removed.

## Verified

- Draft policy syntax validated via Tailscale's own `validate` operation
  before ever being applied (read-only check).
- Live ACL re-fetched after `update` and diffed against intent — matches
  exactly (`grants`, `ssh`, `tagOwners` all present as designed).
- All 16 `manage_device_tags` calls re-confirmed via a fresh `list_devices`
  call, not inferred from the write responses alone.
- `podA` confirmed still untagged, matching the explicit decision not to
  guess it into scope.

## What's still open

- **GitHub secrets not yet configured** — `TS_OAUTH_CLIENT_ID` /
  `TS_OAUTH_CLIENT_SECRET` need a repo admin to add them (see
  `infra/tailscale/README.md`). Until then, any further ACL change needs a
  manual apply, noted as such in the PR.
- **Tenant-zone and backup-zone grants intentionally absent** — no real
  tenant or backup target exists yet to scope them to. Build these in the
  same change that does Phase 3 device enrollment / real backups.
- **`podA`, `fleetbase`, `gean-devnet`, `usher-node`, `homeassistant`
  remain unclassified.** Not a blocker, just tracked.
