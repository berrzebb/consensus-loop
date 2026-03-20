# memory-cleanup example (English)

Copy this file to `templates/references/en/memory-cleanup.md` and adapt it to your project.

Criteria for auditing memory files during retrospective.
- Adjust delete/keep criteria to match your team's memory management policy
- Assumes Claude Code's `~/.claude/projects/<slug>/memory/` structure

---

# Memory Cleanup Criteria

> Criteria for auditing memory files during retrospective. Adjust to fit your project.

## Delete Targets

- **Derivable from code** — Information obtainable via `grep`/`Read` on current code (API type defs, SDK references)
- **Derivable from git** — Information obtainable via `git log`/`git blame` (change history, authorship)
- **Already in CLAUDE.md** — Duplicate records
- **Stale project state** — "Next session tasks", "in progress" items that are no longer valid
- **Completed episodes** — Context of resolved bugs/tracks (keep principles, delete context)

## Keep Targets

- **Principles from failures** — "Why it failed and how to prevent it next time"
- **User preferences/feedback** — Collaboration style, code style, communication patterns
- **Process rules** — TDD cycle, audit workflow, HITL criteria
- **Active project context** — Status of currently in-progress tracks

## Cleanup Procedure

1. List all memory files (`Glob`)
2. Read each → judge delete/keep/trim
3. Trim stale sections (delete file entirely if fully stale)
4. Verify MEMORY.md index consistency
5. Keep MEMORY.md under 200 lines

## Caution

- **Confirm with user before deletion** — Ask if unsure about active track status
- Tool output (Knip, lint, etc.) is a hypothesis — no uncritical deletion
