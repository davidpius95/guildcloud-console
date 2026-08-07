---
name: guildcloud-devops-engineer
description: Handle GuildCloud's git workflow, deployment, environment, and release discipline with a senior DevOps engineer's judgment — repo sync, commit hygiene, and the verify-green gate before anything ships. Use this for git operations, deciding what goes in a commit, checking repo/remote sync, or setting up any CI/deploy-adjacent tooling for this project.
---

# Acting as GuildCloud's DevOps engineer

## Repo layout (don't confuse these)

- **Code:** `github.com/davidpius95/guildcloud-console` — this repo, `main`
  branch, no other branches in use. Deliberately separate from
  `github.com/davidpius95/guildcloud`, the user's older/parallel monorepo
  (Go control plane + a different Next.js portal). Never assume they should
  be merged without asking — that separation was a deliberate choice.
- **Plan:** the master plan docx lives *outside* git, at
  `/Users/user/Documents/Codex/2026-08-06/realtime-voice-chat-2/outputs/GuildCloud-Master-Plan.docx`.
  It is not version-controlled unless explicitly asked to be — check before
  assuming its edit history is recoverable from git.
- **Docs:** `docs/` inside this repo, committed normally.

## Sync discipline

Before starting substantial work, and before telling the user "it's synced":

```bash
git status --short          # working tree clean?
git fetch origin
git log --oneline origin/main..main   # local ahead?
git log --oneline main..origin/main   # local behind?
```

All three should be empty/clean for "fully synced" to be a true statement.
Don't say "everything's in sync" without having just run this.

## Commit discipline

- **Never commit without being explicitly asked.** This has been the
  standing instruction throughout this project — build and verify freely,
  but commits and pushes are a separate, always-confirmed step.
- Stage explicitly (`git add <specific files>`, review with `git status`
  before a broad add) — check for anything that looks like it could hold a
  secret before committing, even though this project currently has none
  (mock data only).
- Commit messages: explain *why*, not a changelog of *what* — this project's
  commits consistently do this (e.g. "Complete the remaining Section 13
  Table A MVP-critical requirements" with a body explaining the plan
  cross-references, not just a file list).
- One coherent chunk of work per commit — this project has been committing
  after each meaningfully complete feature set, not after every file edit.

## Before every push

Run the full `guildcloud-verify-green` checklist — typecheck, build, browser
verification. A broken `main` blocks whoever pulls next, including a
handoff to Codex.

## Environment / local dev

- Dev server: `npm run dev` (port 3100, per `.claude/launch.json` — the
  Browser pane tooling drives this via `preview_start`, never run it
  manually in a way that fights the managed preview server).
- No `.env` files exist yet — there are no secrets to manage because there's
  no backend. When Phase 1 introduces real credentials (Paystack/Flutterwave
  keys, database URL, Proxmox site-worker credentials), this skill should be
  updated with the actual secret-management approach chosen — don't
  improvise one ad hoc mid-feature.

## When infrastructure changes are involved

Phase 0+ work touches the real Guild-A Proxmox cluster via MCP tools. That is
infrastructure, not application deployment — treat it with the higher bar in
`proxmox-api-operations` and `guildcloud-network-engineer`/
`guildcloud-security-engineer`, not as a routine deploy step.

## What CI should eventually check (not yet wired up)

If/when GitHub Actions or similar is introduced: `tsc --noEmit`, `npm run
build`, and ideally the same browser-verification checklist in an automated
form. Until then, this skill (run manually, every time) is the CI.
