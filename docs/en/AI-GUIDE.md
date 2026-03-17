# consensus-loop AI Agent Guide

> This document is for **AI agents (Claude)** working in projects with the consensus-loop hook installed.

## Your Role

You are the **implementer**. You write code, run tests, and submit evidence. A separate **auditor** (GPT/Codex) independently reviews your work. Your work is not complete until the auditor approves it.

## Core Cycle

```
1. Write/modify code
2. Submit evidence → write to watch_file with [trigger_tag]
3. Hook automatically starts audit in background (async — non-blocking)
4. Audit completes → results auto-synced
5a. [agree_tag] → consensus reached → perform retrospective → commit
5b. [pending_tag] → corrections needed → fix issues → return to step 2
```

## Evidence Package Format

Write to the watch_file (typically `docs/feedback/claude.md`):

```markdown
## [trigger_tag] Task Title

### Claim
Describe what you did, specifically.

### Changed Files
- `path/to/file.ts` — description of changes

### Test Command
```bash
npx vitest run tests/specific-file.test.ts
```

### Test Result
- `1 file / 10 tests passed`
- `npx eslint path/to/file.ts`: passed
- `npx tsc --noEmit`: passed

### Residual Risk
Known unresolved items.
```

## Absolute Rules

1. **Only use `[trigger_tag]`** — never use non-standard labels like `[Done]`, `[Partial]`. The auditor uses `[agree_tag]` or `[pending_tag]`.
2. **No self-promotion** — you cannot apply `[agree_tag]` yourself. Only the auditor promotes.
3. **Test Commands must be re-runnable** — the auditor copies and executes them verbatim. No glob patterns.
4. **Every changed file must pass eslint individually** — one failure means rejection.
5. **Never modify design docs** — `docs/` design documents are read-only.

## Async Audit Behavior

When you submit evidence (save watch_file with `[trigger_tag]`):

1. The PostToolUse hook starts the audit in the **background**
2. The hook returns immediately — **continue with other work**
3. If `audit.lock` exists, an audit is in progress
4. **Register a 3-minute Cron watcher via CronCreate**:
   - Check `audit.lock` existence
   - Run `node .claude/hooks/consensus-loop/respond.mjs` (idempotent)
   - Report results to user if any
5. When the audit completes, `audit.lock` is deleted and results auto-sync

## Responding to [pending_tag] Rejections

When the auditor rejects, `respond.mjs` reports the correction items. Common rejection codes:

| Code | Meaning |
|------|---------|
| `test-gap [major]` | Tests don't sufficiently verify the claim |
| `claim-drift [minor]` | Evidence description doesn't match actual code |
| `lint-gap [major]` | Changed file failed eslint |
| `scope-mismatch [major]` | Claim scope doesn't match actual changes |

Correction procedure:
1. Check the rejection's specific locations (file:line)
2. Fix the code
3. Update the same evidence package and resubmit (keep `[trigger_tag]`)

## Retrospective Protocol (Auto-Start)

When all items reach `[agree_tag]`, the session-gate activates and you must **start the retrospective immediately without waiting for user instruction**:

1. Bash/Agent are blocked (only Read/Write/Edit allowed)
2. **Immediately** present the retrospective to the user:
   - What went well this cycle
   - What went wrong (honest improvements)
   - What to improve
3. Exchange feedback with the user
4. Extract repeatable principles from feedback → save to memory
5. Clean up memory — remove duplicate/stale entries
6. Record handoff
7. Run `echo session-self-improvement-complete` → gate clears
8. Commit allowed

## Policy File References

Audit criteria are managed as files, not code:

| File | Content |
|------|---------|
| `templates/references/{locale}/rejection-codes.md` | Rejection code definitions + severity |
| `templates/references/{locale}/test-checklist.md` | Test sufficiency criteria |
| `templates/references/{locale}/output-format.md` | Audit result format rules |
| `templates/references/{locale}/evidence-format.md` | Evidence package format |
| `templates/references/{locale}/principles.md` | Code quality principles |

Reading these files helps you understand how the auditor will judge your work.
