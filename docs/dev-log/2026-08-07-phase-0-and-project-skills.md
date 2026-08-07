# 2026-08-07 — Phase 0 inventory and project skills

## What changed

1. **Phase 0 site inventory completed** for the real Guild-A Proxmox cluster,
   via read-only API survey (Proxmox MCP + Tailscale MCP, `guildcloud@pve`
   audit account). Four artifacts written to `docs/phase-0/`:
   `site-inventory.md`, `network-map.md`, `capacity-model.md`,
   `gap-register.md`. This is the plan's own required Phase 0 deliverable
   (§17: "Perform a read-only infrastructure inventory for each site").

2. **17 findings logged** in the gap register, 3 rated Critical: a fully open
   Tailscale ACL (G-01, no per-project network isolation exists despite
   being the product's core promise), zero backups (G-02), and — cutting
   across several — no control plane exists at all yet (G-04, expected at
   this stage but blocks everything downstream).

3. **11 project skills added** under `.claude/skills/`: four workflow skills
   (context handoff to Codex, a verify-green testing gate, a documentation
   workflow, and coding standards) and seven expert-role skills (senior
   engineer, network engineer, product designer, infra architect, security
   engineer, DevOps engineer, general IT). Indexed in
   `.claude/skills/README.md`.

## Why

The user asked to start Phase 0 per the plan's own Implementation Plan
sequencing, and separately asked for a durable way to (a) hand off context to
Codex, (b) enforce a test-before-proceeding gate, (c) keep documentation
current, and (d) apply consistent engineering/security/network/product
judgment across sessions rather than re-deriving it each time.

## Verified

- Every inventory number was pulled live from the Proxmox and Tailscale APIs
  in this session, not estimated — see the "Method" line at the top of each
  `docs/phase-0/*.md` file for exactly which calls.
- No infrastructure was changed — the survey was read-only throughout
  (`guildcloud@pve` holds `PVEAuditor` only).
- Skills were checked against the actual current repo state (mock-data
  boundary, component patterns, git history) rather than written generically.

## What's still open

- The gap register's "Immediate next actions" section orders the real next
  infrastructure work: close G-01 (open ACL) first, decide G-06 (standing
  root SSH grant) explicitly, then backups/HA, then G-14 (what happens to
  the pre-existing non-GuildCloud workloads sharing this cluster).
- The master plan docx was not modified in this session — Phase 0 evidence
  lives in `docs/phase-0/` per §14's own artifact naming, which the plan
  already anticipates rather than requiring a docx edit for.
- Skills are dated to this survey; they should be revisited once real
  infrastructure changes (especially G-01, G-02) land, since several state
  "current state" facts that this work will change.
