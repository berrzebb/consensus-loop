# consensus-loop AI Agent Guide

> This document is for **AI agents (Claude)** working in projects with the consensus-loop hook installed.

## Role Chain

consensus-loop is a multi-agent protocol with 5 roles in a cycle:

| Role | Responsibility | Isolation |
|------|---------------|-----------|
| **planner** | Track definition + execution plan (work-breakdown) adjustment | fork (Opus) |
| **scout** | Read-only RTM generation — 3-way traceability matrix from work-breakdowns using deterministic tools | fork (Opus) |
| **orchestrator** | Select WB → scout RTM → distribute to implementer → retrospective → squash merge → handoff | main session |
| **implementer** | Implement in worktree + test + submit evidence + WIP commit | worktree (Sonnet) |
| **auditor** | Independent evidence verification → agree/reject verdict | separate process (GPT/Codex) |

> **Note**: The authoritative implementer spec is `agents/implementer.md`. The scout spec is `agents/scout.md`.

## Full Cycle

```
planner ─── Track definition + execution plan adjustment
    ↓
orchestrator ─── Select WB from execution-order
    ↓
scout ─── dependency_graph + code_map → 3-way RTM (Forward/Backward/Bidirectional)
    ↓
orchestrator ─── Distribute Forward RTM rows → scope validation → parallel spawn
    ↓                                          (non-overlapping files only)
┌─── Track A (worktree) ──────┐  ┌─── Track B (worktree) ──────┐
│  implementer: implement+test │  │  implementer: implement+test │
│  → consensus-loop:verify     │  │  → consensus-loop:verify     │
│    (CQ/T/CC/CL/S/I/FV/CV)   │  │    (CQ/T/CC/CL/S/I/FV/CV)   │
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

## Deterministic Tools (MCP)

Use deterministic tools before LLM reasoning — facts first, inference second:

| Tool | Purpose | Used By |
|------|---------|---------|
| `code_map` | Cached symbol index (fn/class/type with line ranges) | Scout, Implementer, Planner |
| `dependency_graph` | Import/export DAG, components, topological sort, cycles | Scout, Orchestrator, Planner |
| `audit_scan` | Pattern scan (type-safety, hardcoded, console) | Implementer, Verify |
| `coverage_map` | Per-file coverage % from vitest JSON | Verify, Implementer |
| `rtm_parse` | Parse RTM markdown → structured rows, filter by req_id/status | Scout, Implementer, Orchestrator |
| `rtm_merge` | Row-level merge of worktree RTMs with conflict detection | Orchestrator, Merge |
| `audit_history` | Query persistent audit history — verdicts, rejection patterns, risk detection | Orchestrator, Planner, Retrospective |
| `fvm_generate` | FE 라우트 × API 호출 × BE 엔드포인트 × 접근 정책 교차 분석 → FVM 테이블 | Scout, Orchestrator, Verify |
| `fvm_validate` | FVM 행을 HTTP fetch로 실행 — 역할별 인증 후 expected vs actual 비교 | Validator, Verify |

## Evidence Package Format

Write to the watch_file (typically `docs/feedback/claude.md`) using **Write (full replacement)**.

Follow the format in `${CLAUDE_PLUGIN_ROOT}/templates/references/${locale}/evidence-format.md`.

Required sections:

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

**Always** run `/consensus-loop:verify` before submitting evidence. It executes 8 categories sequentially:

| # | Category | Codes | Checks | Pass Condition |
|---|----------|-------|--------|----------------|
| 1 | Code Quality | CQ-1~CQ-4 | Per-file eslint + tsc + no forbidden patterns | All changed files pass lint/tsc |
| 2 | Test | T-1~T-4 | Test execution + direct test per claim + no regressions | Evidence test commands pass |
| 3 | Claim-Code Consistency | CC-1~CC-3 | Claim matches code behavior + file list matches diff | No claim ↔ diff mismatch |
| 4 | Cross-Layer Contract | CL-1~CL-3 | BE→FE documented + new interface has consumer | Cross-layer contracts traceable |
| 5 | Security | S-1~S-3 | New inputs validated + endpoints auth-guarded + sensitive data not exposed | No OWASP violations |
| 6 | i18n | I-1~I-2 | User strings use locale keys + keys present in ALL locales | No hardcoded strings |
| 7 | Frontend Verification | FV-1~FV-5 | Page loads + DOM elements + no console errors + build succeeds | Only runs when FE files changed |
| 8 | Coverage | CV-1~CV-3 | stmt ≥ 85%, branch ≥ 75%, coverage data exists | Per-file thresholds met |

Output: Integrated PASS/FAIL table per category. **All must PASS before submission**.

## Rejection Codes

| Code | Severity | Meaning | Trigger |
|------|----------|---------|---------|
| `needs-evidence` | major/minor | Evidence package missing or weak | Core claim unsupported / partial gaps |
| `scope-mismatch` | **major** | Claim vs code scope mismatch | Files in diff not in evidence or vice versa |
| `lint-gap` | **major** | Lint failed | CQ-1/CQ-2 fails. Must include `file:L{line}` + error |
| `test-gap` | **major** | Tests missing/insufficient | T-1 fails or T-2 not met (no direct test) |
| `claim-drift` | **minor** | Evidence doesn't match code behavior | CC-1 fails (evidence says X, code does Y) |
| `principle-drift` | major/minor | SOLID/YAGNI/DRY/KISS/LoD violation | Structural regression / minor principle violation |
| `security-drift` | **critical** | OWASP TOP 10 violation | S-1/S-2/S-3 fails. Must include attack scenario |
| `regression` | **major** | Existing test broke | T-3 fails (previously passing test now fails) |
| `i18n-gap` | **minor** | Hardcoded user-facing strings | I-1/I-2 fails (strings not using locale keys) |
| `contract-gap` | **major** | Cross-layer contract broken | CL-1/CL-2/CL-3 fails (interface without consumer) |
| `coverage-gap` | **major** | Coverage below threshold | CV-1/CV-2 fails. stmt < 85% or branch < 75% |

## Async Audit Behavior

When you submit evidence (save watch_file with `[trigger_tag]`):

1. The PostToolUse hook starts the audit in the **background** (consecutive edits are debounced for 10 s)
2. The hook returns immediately — **continue with other work**
3. If `.claude/audit.lock` exists, an audit is in progress
4. **Register a 3-minute Cron watcher via CronCreate** to check lock status and run respond.mjs
5. When the audit completes, `audit.lock` is deleted and results auto-sync

## [pending_tag] Correction Cycle

When the auditor rejects, `respond.mjs` delivers correction items.

### Single Agent
1. Check the rejection's specific locations (file:line)
2. Fix the code
3. Update the same evidence package and resubmit (keep `[trigger_tag]`)

### Multi-Agent (orchestrator → implementer)

The orchestrator **does not spawn a new agent** for corrections. It sends via `SendMessage`:

- **major** (test-gap, scope-mismatch, lint-gap, coverage-gap) → specific correction instructions
- **minor** (claim-drift) → evidence description update
- **critical** (security-drift) → orchestrator intervenes directly

## Session Gate & Retrospective Protocol

### Session Gate

`session-gate.mjs` (PreToolUse hook):
- **Blocked**: Bash, Agent, Git-related tools
- **Allowed**: Read, Write, Edit, Glob, Grep, TodoWrite
- **Session-aware**: only blocks the completing session
- **Fail-open**: errors pass through silently

### Deferred Retrospective

1. `subagent-stop.mjs` detects implementer completion
2. Sets `deferred_to_orchestrator` flag → retro-marker
3. Orchestrator performs retrospective on their behalf

### Retrospective Procedure

1. Bash/Agent blocked (only Read/Write/Edit allowed)
2. **Immediately** present: what went well / what went wrong / what to improve
3. Exchange feedback with the user
4. Extract principles → save to memory, clean up stale entries
5. `echo session-self-improvement-complete` → gate clears
6. `/consensus-loop:merge` → squash merge → single commit
7. Write session handoff → select next WB

## Skill Reference

| Skill | Purpose | Invocation |
|-------|---------|------------|
| `consensus-loop:orchestrator` | Session orchestration — scout, distribute, track, correct | User or auto |
| `consensus-loop:verify` | Done-criteria verification (CQ/T/CC/CL/S/I/FV/CV) | Before evidence |
| `consensus-loop:merge` | Squash-merge worktree with structured commit | After retro |
| `consensus-loop:planner` | Track definition + work breakdown design | For planning |
| `consensus-loop:guide` | Evidence package writing guide | When preparing |

## Agent Reference

| Agent | Purpose | Model |
|-------|---------|-------|
| `implementer` | Headless worker in worktree — implements, tests, submits evidence | Sonnet |
| `scout` | Read-only RTM generator — 3-way traceability using deterministic tools | Opus |

## Policy File References

| File | Content |
|------|---------|
| `templates/references/{locale}/done-criteria.md` | Done criteria (CQ/T/CC/CL/S/I/CV) |
| `templates/references/{locale}/rejection-codes.md` | Rejection code definitions + severity |
| `templates/references/{locale}/test-checklist.md` | Test sufficiency criteria |
| `templates/references/{locale}/output-format.md` | Audit result format rules |
| `templates/references/{locale}/evidence-format.md` | Evidence package format |
| `templates/references/{locale}/principles.md` | Code quality principles |
| `templates/references/{locale}/traceability-matrix.md` | RTM format (Forward/Backward/Bidirectional) |
