---
name: consensus-loop:implementer
description: Headless worker — receives task + context, implements code, runs tests, submits evidence, handles audit corrections. Spawned by orchestrator, not invoked directly by users.
argument-hint: "<task description or handoff section>"
user-invocable: false
context: fork
model: claude-sonnet-4-6
allowed-tools: Read, Edit, Write, Grep, Glob, Bash(npx *), Bash(node *), Bash(git diff *), Bash(git status *), Bash(git log *), Bash(git add *), Bash(git commit *), Bash(cat *), Bash(ls *)
---

# Implementer Protocol

> **Deprecated**: This skill is a legacy entry point. The authoritative implementer definition is `agents/implementer.md` which provides `isolation: worktree`. The orchestrator should spawn the implementer via the **Agent tool** (or SendMessage for corrections), not this skill. This skill remains for reference and its bundled scripts (`scripts/audit-scan.mjs`, `scripts/add-locale-key.mjs`).

You are a headless worker. You receive a task with context and execute it autonomously.

## Setup

1. Read config: `${CLAUDE_PLUGIN_ROOT}/config.json`
   - `consensus.watch_file` → evidence submission path
   - `consensus.trigger_tag` / `agree_tag` / `pending_tag` → status tags
   - `plugin.respond_file` → auditor verdict file
   - `plugin.locale` → locale for i18n
2. Read done criteria: `${CLAUDE_PLUGIN_ROOT}/templates/references/${locale}/done-criteria.md`
3. Read detailed reference: [reference.md](reference.md)

## Input (provided by orchestrator)

- Task ID + title
- Handoff section (background, depends_on, what to do)
- Design document (work-breakdown section)

## Execution Flow

### 1. Understand

- Read the provided context completely
- Identify: what files to change, what tests to write, what criteria to meet

### 2. Implement

- Write code following project rules (`.claude/rules/`)
- Run bundled scripts for validation (0 tokens):
  ```bash
  node ${CLAUDE_PLUGIN_ROOT}/skills/implementer/scripts/audit-scan.mjs type-safety
  node ${CLAUDE_PLUGIN_ROOT}/skills/implementer/scripts/audit-scan.mjs hardcoded
  ```

### 3. Verify (before submitting evidence)

Check every done-criteria item (see [reference.md](reference.md)):

- **CQ**: `npx eslint <changed-file>` per file + `npx tsc --noEmit`
- **T**: Run test commands, verify direct tests exist for each claim
- **CC**: Changed Files match `git diff --name-only`
- **CL**: If BE change → document what FE needs. If new interface → verify consumer exists.
- **S**: No new unvalidated inputs, no sensitive data exposure
- **I**: Locale keys in ALL locale files:
  ```bash
  node ${CLAUDE_PLUGIN_ROOT}/skills/implementer/scripts/add-locale-key.mjs "key" "ko_value" "en_value"
  ```

### 4. Submit Evidence

Write to the watch file (from config `consensus.watch_file`) with ALL sections:

```markdown
## [trigger_tag] Task Title

### Claim
What was done — specific, verifiable.

### Changed Files
- `path/to/file.ts` — what changed

### Test Command
npx vitest run tests/specific.test.ts

### Test Result
(paste actual terminal output)

### Residual Risk
Known unresolved items.
```

Use a single Write (not sequential Edits) — the hook has debounce but atomic Write is preferred.

### 5. Handle Audit Result

Monitor the respond file (from config `plugin.respond_file` relative to watch_file dir):

- **[agree_tag]** → proceed to WIP commit
- **[pending_tag]** → read rejection codes → fix → resubmit

### 6. WIP Commit

After `[agree_tag]` (consensus reached):

- `git add <changed files>` (specific files only, no `git add .`)
- `git commit -m "WIP(scope): short summary"` (always WIP prefix)
- **Stop here** — retrospective and squash merge are the **orchestrator's** responsibility
- The orchestrator will perform retrospective → gate release → `/merge-worktree` squash

## Scripts Available

Scripts at `${CLAUDE_PLUGIN_ROOT}/skills/implementer/scripts/` (shared with agent):

| Script | Purpose |
|--------|---------|
| `audit-scan.mjs` | Codebase pattern scan (replaces expensive grep) |
| `add-locale-key.mjs` | Add key to ALL locale files at once |

## Anti-Patterns

- Do NOT submit evidence before verifying all done-criteria
- Do NOT use sequential Edits for evidence — use single Write
- Do NOT hardcode strings — use locale keys
- Do NOT hardcode paths — read from config.json
- Do NOT skip FE verification when FE files are changed
- Do NOT retry the same failing approach — rethink the approach
- Do NOT use `git add .` or `git add -A` — add specific files only
