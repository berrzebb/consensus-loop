# consensus-loop AI Agent Guide

> This document is for **AI agents (Claude)** working in projects with the consensus-loop hook installed.

## Role Chain

consensus-loop is a multi-agent protocol with 4 roles in a cycle:

| Role | Responsibility | Isolation |
|------|---------------|-----------|
| **planner** | Track definition + execution plan (work-breakdown) adjustment | fork (Opus) |
| **orchestrator** | Select WB from execution-order → distribute to implementer → retrospective → squash merge → handoff | main session |
| **implementer** | Implement in worktree + test + submit evidence + WIP commit | worktree (Sonnet) |
| **auditor** | Independent evidence verification → agree/reject verdict | separate process (GPT/Codex) |

## Full Cycle

```
planner ─── Track definition + execution plan adjustment
    ↓
orchestrator ─── Select WB from execution-order → distribute to implementer
    ↓
┌─── implementer (worktree) ──────────────────────────┐
│  1. Implement code + tests                           │
│  2. /verify-implementation (CQ/T/CC/CL/S/I checks)  │
│  3. Submit evidence → watch_file with [trigger_tag]  │
│  4. Audit starts automatically (async)               │
│  5a. [agree_tag] → WIP commit                        │
│  5b. [pending_tag] → fix → return to step 3          │
└──────────────────────────────────────────────────────┘
    ↓ (consensus + WIP commit)
Retrospective protocol (session-gate blocks Bash/Agent)
    → what went well / what went wrong / memory update
    → "session-self-improvement-complete" → gate release
    ↓
orchestrator: /merge-worktree → squash merge → single commit
    ↓
orchestrator: write session handoff → select next WB → loop
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

1. The PostToolUse hook starts the audit in the **background** (consecutive edits are debounced for 10 s)
2. The hook returns immediately — **continue with other work**
3. If `.claude/audit.lock` exists, an audit is in progress (created in repo's `.claude/` directory)
4. **Register a 3-minute Cron watcher via CronCreate**:
   - Check `.claude/audit.lock` existence
   - Run `node ${CLAUDE_PLUGIN_ROOT}/respond.mjs` (idempotent, plugin mode) or `node .claude/hooks/consensus-loop/respond.mjs` (legacy)
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

## Retrospective Protocol

Retrospective is **mandatory in all contexts** after consensus is reached. The session-gate blocks Bash/Agent, making it impossible to skip.

> **Technical note**: Subagents (implementer) pass through session-gate and cannot perform retrospective directly. In this case, `deferred_to_orchestrator` is set and the orchestrator performs it on their behalf. This is not an exception to the principle — it is a technical limitation requiring delegation.

Retrospective procedure:

1. Bash/Agent blocked (only Read/Write/Edit allowed)
2. **Immediately** present the retrospective (do not wait for user instruction):
   - What went well this cycle
   - What went wrong (honest improvements)
   - What to improve
3. Exchange feedback with the user
4. Extract repeatable principles from feedback → save to memory
5. Clean up memory — remove duplicate/stale entries
6. Run `echo session-self-improvement-complete` → gate clears
7. orchestrator: `/merge-worktree` → squash merge → single structured commit
8. orchestrator: write session handoff → select next WB

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
