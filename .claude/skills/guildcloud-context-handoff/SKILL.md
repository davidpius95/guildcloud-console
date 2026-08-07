---
name: guildcloud-context-handoff
description: Package this GuildCloud session's memory, history, and context into a handoff document so development can continue in Codex, a fresh Claude session, or any other agent. Use this whenever the user asks to "hand off", "continue in Codex", "sync context", "catch up a new session", or before a long break in work — because GuildCloud's real state lives across four places (memory files, the master plan docx, docs/, and git history) that no single tool surfaces together, so a naive summary silently drops one of them.
---

# Handing off GuildCloud context to another agent

GuildCloud's ground truth is split across four places. A handoff is only
complete if it touches all four — dropping one is how a new session rebuilds
something that already exists, or contradicts a decision that was already made.

| Source | What it holds | Where |
| --- | --- | --- |
| Memory | Why decisions were made, standing preferences | `~/.claude/projects/-Users-user-untitled-folder/memory/guildcloud-project.md` |
| Master plan | The binding source of truth for scope | `/Users/user/Documents/Codex/2026-08-06/realtime-voice-chat-2/outputs/GuildCloud-Master-Plan.docx` |
| docs/ | Phase evidence, dev log, decision records | `docs/phase-0/`, `docs/dev-log/`, `docs/decisions/` |
| Git | What actually shipped, in what order | `git log --oneline`, the repo itself |

## Producing a handoff

1. **Read, don't guess, the current state of each source.**
   - `Read` the memory file directly — don't rely on what's cached in
     conversation context, it may be stale.
   - Re-extract the plan's current section list if scope may have changed:
     ```bash
     python3 -c "
     import docx
     d = docx.Document('/Users/user/Documents/Codex/2026-08-06/realtime-voice-chat-2/outputs/GuildCloud-Master-Plan.docx')
     for p in d.paragraphs:
         if p.style.name.startswith('Heading'): print(p.text)
     "
     ```
     (Needs `python-docx` — see `venv` setup in the docx skill if missing.)
   - `git log --oneline` and `git status --short` for what's actually committed
     vs. sitting in the working tree.
   - `ls docs/dev-log/` for the most recent entries.

2. **Write the handoff as a single markdown file**, not a chat summary — it
   needs to survive outside this conversation. Save it to
   `docs/dev-log/<date>-handoff.md` and structure it as:

   ```markdown
   # Handoff — <date>

   ## What GuildCloud is
   One paragraph: private-by-default multi-site cloud platform, Proxmox
   execution plane, plan-first development. Link the master plan path.

   ## Where the plan stands
   Current section count, what changed most recently (e.g. "Section 13 added
   2026-08-07, confirms 7 MVP-critical UI/UX requirements"). Link section
   numbers, don't paraphrase requirements — the next agent should read the
   plan itself for anything load-bearing.

   ## Where the build stands
   - Repo: github.com/davidpius95/guildcloud-console (or current remote)
   - What's real vs. mock: be explicit. As of this writing, the entire
     console is Next.js + mock data in lib/mock-data.ts — no API routes, no
     database, no auth. State this plainly; it's the single fact most likely
     to be assumed away by a fresh session.
   - Last 5-10 commits and what each did (git log --oneline -10)
   - Open tasks (from TaskList if any are still pending)

   ## Infrastructure state (if Phase 0+ has started)
   Link docs/phase-0/*.md rather than re-summarizing — those are the
   authoritative, dated survey artifacts. Flag anything CRITICAL from the gap
   register by ID (e.g. "G-01 open Tailscale ACL — unresolved as of <date>").

   ## What to do next
   The specific next task, referencing plan section + phase number.
   ```

3. **Never paraphrase the plan's binding requirements from memory.** Link the
   docx and the relevant section number. Memory is for *why* a choice was
   made and *how to work with the user*, not a substitute for the plan text
   — paraphrasing drifts, and GuildCloud's whole discipline (§1) is that the
   plan is the source of truth.

4. **State honestly what's mock vs. real.** The single most damaging failure
   mode for a handoff is a new agent believing a mocked flow (payment,
   backup, access policy) is backed by real infrastructure because a UI for
   it exists. Every handoff must include the "what's real vs. mock" line
   above, updated to current state.

## Handing off specifically to Codex

Codex reads plain files, not Claude memory or MCP tool state. Before handing
off:

- Commit and push everything — Codex should start from `git clone` /
  `git pull`, not from files that only exist in this session's working tree.
- Make sure `docs/dev-log/<date>-handoff.md` is committed too, so it travels
  with the repo rather than living only in this conversation.
- Do not assume Codex has the same MCP tools (Proxmox, Tailscale) connected —
  if the handoff references live infrastructure state, it must be the
  **captured** state in `docs/phase-0/`, not "ask the MCP server," since that
  server may not be reachable from wherever Codex runs.

## After handing off

Tell the user directly: "Handoff written to `docs/dev-log/<file>.md` and
pushed. Codex should start by reading that file, then the master plan
sections it links." Don't just say "context is synced" — name the file.
