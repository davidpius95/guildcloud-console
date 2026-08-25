# GuildCloud docs

The master plan (`GuildCloud-Master-Plan.docx`, outside this repo — see
memory or `guildcloud-context-handoff`) is the source of truth for scope and
requirements. This directory is where evidence, decisions, and history live
as the project is actually built. See `.claude/skills/guildcloud-docs` for
the full writing guide; this file is just the map.

```
docs/
  dev-log/       one dated entry per work session
  decisions/     Decision Records for material, hard-to-reverse choices
  phase-0/       site inventory, network map, capacity model, gap register
  phase-N/       (later phases add their own required evidence per §14)
```

## Start here if you're new to this project (including Codex)

1. Read the master plan's table of contents (17 sections as of 2026-08-07) —
   the docx itself, not a summary.
2. Read `docs/phase-0/gap-register.md` for the current honest state of the
   real infrastructure.
3. Read the most recent `docs/dev-log/` entry for what's happened most
   recently.
4. `.claude/skills/README.md` for how to work on this project going forward.

For a maintained internal visual map of the implemented system, read
[architecture.md](architecture.md). It complements the status and phase
evidence; it does not replace the live capacity/admission records.
