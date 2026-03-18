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

> **Note**: The authoritative implementer spec is `agents/implementer.md`. The `consensus-loop:implementer` skill is a legacy entry point.

## Full Cycle

```
planner ─── Track definition + execution plan adjustment
    ↓
orchestrator ─── Select WB from execution-order → scope validation → parallel distribute
    ↓                                              (non-overlapping files only)
┌─── Track A (worktree) ──────┐  ┌─── Track B (worktree) ──────┐
│  implementer: implement+test │  │  implementer: implement+test │
│  → consensus-loop:verify     │  │  → consensus-loop:verify     │
│    (CQ/T/CC/CL/S/I/FV)      │  │    (CQ/T/CC/CL/S/I/FV)      │
│  → submit evidence           │  │  → submit evidence           │
│  → audit (async)             │  │  → audit (async)             │
│  [pending_tag] → SendMessage │  │  [agree_tag] → WIP commit    │
│  → correction → resubmit    │  │                               │
│  [agree_tag] → WIP commit   │  │                               │
└──────────────────────────────┘  └──────────────────────────────┘
    ↓ (all tracks: agree_tag + WIP commit)
Retrospective protocol (session-gate blocks Bash/Agent)
    → what went well / what went wrong / memory update
    → "session-self-improvement-complete" → gate release
    ↓
orchestrator: /consensus-loop:merge → squash merge → single commit
    ↓
orchestrator: write session handoff → select next WB → loop
```

## Evidence Package Format

Write to the watch_file (typically `docs/feedback/claude.md`) using **Write (full replacement)**:

```markdown
## [trigger_tag] Task Title

### Claim
Describe what you did, specifically. Changes not mentioned in the claim must not appear in the diff.

### Changed Files

**Code**
- `src/path/to/file.ts` — description of changes

**Tests**
- `tests/path/to/file.test.ts` — test additions/modifications

### Test Command
```bash
npx vitest run tests/specific-file.test.ts
npx eslint src/path/to/file.ts
npx tsc --noEmit
```

### Test Result
```
Paste actual terminal output here verbatim.
No summaries — the auditor must be able to verify the raw output.
```

### Residual Risk
Known unresolved items. If exploitable by an attacker, it is a fix target, not residual risk.
Write "None" if there are no known unresolved items.
```

## Absolute Rules

1. **Only use `[trigger_tag]`** — never use non-standard labels like `[Done]`, `[Partial]`. The auditor uses `[agree_tag]` or `[pending_tag]`.
2. **No self-promotion** — you cannot apply `[agree_tag]` yourself. Only the auditor promotes.
3. **Test Commands must be re-runnable** — the auditor copies and executes them verbatim. No glob patterns.
4. **Every changed file must pass eslint individually** — one failure means rejection.
5. **Never modify design docs** — `docs/` design documents are read-only.
6. **Exactly 1 evidence section per submission** — do not submit multiple evidence sections simultaneously.
7. **Changed Files must match the actual diff** — files in the diff but not in the evidence (or vice versa) trigger `scope-mismatch` rejection.

## Verification Sequence (consensus-loop:verify)

**Always** run `/consensus-loop:verify` before submitting evidence. It executes 7 categories sequentially:

| # | Category | Codes | Checks | Pass Condition |
|---|----------|-------|--------|----------------|
| 1 | Code Quality | CQ-1~CQ-4 | Per-file eslint + tsc + no forbidden patterns | All changed files pass lint/tsc |
| 2 | Test | T-1~T-4 | Test execution + direct test per claim + no regressions | Evidence test commands pass |
| 3 | Claim-Code Consistency | CC-1~CC-3 | Claim matches code behavior + file list matches diff | No claim ↔ diff mismatch |
| 4 | Cross-Layer Contract | CL-1~CL-3 | BE→FE documented + new interface has consumer | Cross-layer contracts traceable |
| 5 | Security | S-1~S-3 | New inputs validated + endpoints auth-guarded + sensitive data not exposed | No OWASP violations |
| 6 | i18n | I-1~I-2 | User strings use locale keys + keys present in ALL locales | No hardcoded strings |
| 7 | Frontend Verification | FV-1~FV-5 | Page loads + DOM elements + no console errors + build succeeds | Only runs when FE files changed |

Output: Integrated PASS/FAIL table per category. **All must PASS before submission**.

## Rejection Codes

Full list of rejection codes used by the auditor:

| Code | Severity | Meaning | Trigger |
|------|----------|---------|---------|
| `needs-evidence` | major/minor | Evidence package missing or weak | Core claim unsupported / partial gaps |
| `scope-mismatch` | **major** | Claim vs code scope mismatch | Files in diff not in evidence or vice versa |
| `lint-gap` | **major** | Lint failed | CQ-1/CQ-2 fails. Must include `file:L{line}` + error |
| `test-gap` | **major** | Tests missing/insufficient | T-1 fails or T-2 not met (no direct test) |
| `claim-drift` | **minor** | Evidence description doesn't match code behavior | CC-1 fails (evidence says X, code does Y) |
| `principle-drift` | major/minor | SOLID/YAGNI/DRY/KISS/LoD violation | Structural regression / minor principle violation |
| `security-drift` | **critical** | OWASP TOP 10 violation | S-1/S-2/S-3 fails. Must include attack scenario |
| `regression` | **major** | Existing test broke | T-3 fails (previously passing test now fails) |
| `i18n-gap` | **minor** | Hardcoded user-facing strings | I-1/I-2 fails (strings not using locale keys) |
| `contract-gap` | **major** | Cross-layer contract broken | CL-1/CL-2/CL-3 fails (interface without consumer) |

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

## [pending_tag] Correction Cycle

When the auditor rejects, `respond.mjs` delivers correction items.

### Correction Procedure (Single Agent)
1. Check the rejection's specific locations (file:line)
2. Fix the code
3. Update the same evidence package and resubmit (keep `[trigger_tag]`)

### Correction Procedure (Multi-Agent — orchestrator → implementer)

The orchestrator **does not spawn a new agent** for corrections. It sends correction instructions to the existing agent's `agent_id` via `SendMessage`:

- **major rejection** (test-gap, scope-mismatch, lint-gap) → SendMessage with specific correction instructions
- **minor rejection** (claim-drift) → SendMessage requesting evidence description update
- **critical rejection** (security-drift) → orchestrator intervenes directly to fix

After correction, the implementer resubmits evidence and the audit restarts.

## Session Gate & Retrospective Protocol

### Session Gate Behavior

`session-gate.mjs` (PreToolUse hook) restricts tools until retrospective is complete:

- **Blocked**: Bash, Agent, Git-related tools
- **Allowed**: Read, Write, Edit, Glob, Grep, TodoWrite (for memory work)
- **Session-aware**: only blocks the session that completed the audit (other sessions unaffected)
- **Fail-open**: errors pass through silently (never locks the system)

### Deferred Retrospective

Subagents (implementer) pass through session-gate and cannot perform retrospective directly:

1. `subagent-stop.mjs` detects implementer completion
2. Sets `deferred_to_orchestrator` flag → recorded in retro-marker
3. Orchestrator performs retrospective on their behalf

This is not an exception to the principle — it is a technical limitation requiring delegation.

### Retrospective Procedure

1. Bash/Agent blocked (only Read/Write/Edit allowed)
2. **Immediately** present the retrospective (do not wait for user instruction):
   - What went well this cycle
   - What went wrong (honest improvements)
   - What to improve
3. Exchange feedback with the user
4. Extract repeatable principles from feedback → save to memory
5. Clean up memory — remove duplicate/stale entries
6. Run `echo session-self-improvement-complete` → gate clears
7. orchestrator: `/consensus-loop:merge` → squash merge → single structured commit
8. orchestrator: write session handoff → select next WB

## Policy File References

Audit criteria are managed as files, not code:

| File | Content |
|------|---------|
| `templates/references/{locale}/rejection-codes.md` | Rejection code definitions + severity |
| `templates/references/{locale}/test-checklist.md` | Test sufficiency criteria |
| `templates/references/{locale}/output-format.md` | Audit result format rules |
| `templates/references/{locale}/evidence-format.md` | Evidence package format |
| `templates/references/{locale}/done-criteria.md` | 21 done criteria (CQ/T/CC/CL/S/I/FV) |
| `templates/references/{locale}/principles.md` | Code quality principles |

Reading these files helps you understand how the auditor will judge your work.
