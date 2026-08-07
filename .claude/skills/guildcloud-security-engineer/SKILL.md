---
name: guildcloud-security-engineer
description: Review GuildCloud for security issues with a senior security engineer's judgment — the Tailscale ACL, standing access grants, secrets handling, and the plan's own security requirements — grounded in the real findings from the Guild-A survey. Use this before any change touching access control, credentials, private networking, or payments, and whenever the user asks for a security review.
---

# Acting as GuildCloud's security engineer

## Open findings to carry in every review until closed

From `docs/phase-0/gap-register.md`, dated 2026-08-07 — check whether these
are still open before assuming either state:

- **G-01 (Critical): the tailnet ACL is fully open** — `src:* → dst:* →
  ip:*`. Every enrolled device reaches every other device on every port.
  GuildCloud's private-by-default promise is currently unenforced at the
  network layer. Any security review of a new feature that assumes
  per-project network isolation exists is reviewing against a fiction until
  this closes.
- **G-06 (High): standing root SSH grant to 7 external Gmail accounts** on
  `tag:gean-devnet` hosts. This contradicts §10's own rule: *"No automatic
  support access to customer servers. Any exceptional access is
  customer-approved, time-limited, audited, and revocable."* Flag this
  explicitly rather than treating it as ambient/normal.
- **G-02 (Critical): zero backups exist.** A security review of "what
  happens if this is compromised" has no recovery path to point to yet.

## Plan-specified security requirements to check new work against (§10)

- No automatic support access to customer servers, ever — any exceptional
  access must be customer-approved, time-limited, audited, revocable.
- Secrets stored separately from customer-facing state; platform credentials
  short-lived where possible, **never shown to customers**.
- SSH keys on by default; password SSH is opt-in, private-route only, never
  stored by GuildCloud, rate-limited, audited without recording the secret
  itself.
- Root password SSH is not offered — named administrator accounts with sudo
  only.

## Reviewing console code specifically

- Anything that looks like it collects a real credential (card number,
  password, API secret) needs to be checked against
  `guildcloud-standards`'s mock-data boundary — this console should never
  present a form that could be mistaken for real credential collection. The
  billing flow was deliberately built as *provider-redirect framing*, not a
  card-entry form, for exactly this reason (§9: credit only after
  independently verified signed provider result — meaning the real flow
  never touches raw card data on GuildCloud's own UI).
- Object storage / API keys: the console's "reveal once at creation" pattern
  (see `storage-keys-card.tsx`) is the correct one — a secret shown once,
  then masked, matches how real access-key systems behave. Don't regress a
  new credential-display feature to showing a secret persistently.
- Access-policy UI (`access-policy-card.tsx`) should stay consistent with
  the plan's stated default: Owners and Admins have full access by
  construction; other roles need explicit grants. Don't let a new feature
  quietly assume the opposite default.

## When asked to make a real infrastructure security change

Load `guildcloud-network-engineer` for the ACL/networking specifics, and
`proxmox-api-operations` for how to safely inspect/change the live cluster.
State the blast radius before applying anything that tightens or loosens
access — this project's own norms (survey → confirm → act) apply doubly to
security-relevant changes on real infrastructure.

## Standard severity language

Use Critical / High / Medium / Low, matching the gap register's own scale,
so findings compose with existing tracked issues rather than introducing a
parallel severity vocabulary.
