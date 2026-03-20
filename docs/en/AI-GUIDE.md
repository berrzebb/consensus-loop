# consensus-loop AI Agent Guide

> For AI agents (Claude) working in projects with the consensus-loop hook installed.

## Role Chain

| Role | Responsibility | Model | Isolation |
|------|---------------|-------|-----------|
| **planner** | PRD + track definition + work breakdown | Opus | fork |
| **scout** | Read-only RTM generation (3-way traceability) | Opus | fork |
| **orchestrator** | Distribute → scout → implement → audit → retro → merge | — | main session |
| **implementer** | Code + test + evidence + WIP commit | Sonnet | worktree |
| **ui-reviewer** | Browser-based UI verification (states, a11y, interactions) | Sonnet | — |
| **auditor** | Independent evidence verification → agree/reject | GPT/Codex | separate process |

## Full Cycle

```
planner ─── PRD + track definition + work breakdown
    ↓
orchestrator ─── Evaluate tier → select WB
    ↓
┌─ Tier 1 (Micro): direct fix → verify CQ+T → commit
├─ Tier 2 (Standard): scout → worktree → audit → retro → merge
└─ Tier 3 (Complex): mandatory scout → worktree → full audit → regression → retro
    ↓
┌─── Track A (worktree) ──────┐  ┌─── Track B (worktree) ──────┐
│  implementer: implement+test │  │  implementer: implement+test │
│  → verify (CQ/T/CC/CL/S/I)  │  │  → verify (CQ/T/CC/CL/S/I)  │
│  → submit evidence           │  │  → submit evidence           │
│  → audit (async, pre-verified)│  │  → audit (async)            │
│  [pending_tag] → correction  │  │  [agree_tag] → WIP commit   │
│  [agree_tag] → WIP commit    │  │                              │
└──────────────────────────────┘  └──────────────────────────────┘
    ↓
retrospective → /consensus-loop:retrospect (memory update)
    → session-self-improvement-complete → gate release
    ↓
/consensus-loop:merge → squash merge → single commit
    ↓
write handoff → next WB → loop
```

## Task Complexity Tiers

| Tier | Files | Protocol | Audit |
|------|-------|----------|-------|
| **T1 Micro** | 1-2 | Direct fix, no worktree | Orchestrator inline review |
| **T2 Standard** | 3-8 | Worktree + audit cycle | Cross-model (GPT/Codex) |
| **T3 Complex** | 8+ / cross-track | Worktree + scout + full audit | + post-merge regression |

## Evidence Package

Write to watch_file using **Write** (full replacement). Format: `${CLAUDE_PLUGIN_ROOT}/templates/references/${locale}/evidence-format.md`

Required sections: `[trigger_tag] Title`, `Claim`, `Changed Files`, `Test Command`, `Test Result`, `Residual Risk`

## Absolute Rules

1. **Only use `[trigger_tag]`** — never `[Done]`, `[Partial]`
2. **No self-promotion** — only the auditor applies `[agree_tag]`
3. **Test commands must be re-runnable** — no glob patterns
4. **Every changed file must pass eslint** — one failure = rejection
5. **Never modify design docs** — `docs/` is read-only
6. **Changed Files must match diff** — mismatch = `scope-mismatch` rejection
7. **Pre-verify before submission** — run `/consensus-loop:verify`

## Verification (8 Categories)

| # | Category | Pass Condition |
|---|----------|----------------|
| 1 | CQ | All files pass eslint + tsc |
| 2 | T | Evidence test commands pass, direct tests exist |
| 3 | CC | Changed Files match diff scope |
| 4 | CL | BE→FE contracts documented |
| 5 | S | Inputs validated, endpoints auth-guarded |
| 6 | I | Locale keys in ALL locale files |
| 7 | FV | Page loads, no console errors (FE only) |
| 8 | CV | stmt ≥ 85%, branch ≥ 75% |

## Rejection Codes

| Code | Severity | Trigger |
|------|----------|---------|
| `scope-mismatch` | major | Files in diff not in evidence |
| `lint-gap` | major | CQ-1/CQ-2 fails |
| `test-gap` | major | T-1/T-2 fails |
| `claim-drift` | minor | Evidence says X, code does Y |
| `security-drift` | critical | OWASP violation |
| `regression` | major | Existing test broke |
| `coverage-gap` | major | Below threshold |

## Correction Cycle

| Context | Behavior |
|---------|----------|
| Single agent | Fix code → update evidence → resubmit |
| Multi-agent | Orchestrator sends `SendMessage` to existing agent (never spawn new) |
| 3+ rejections | Escalate to user (interactive) or auto-block downstream (headless) |

## Session Gate & Retrospective

- `session-gate.mjs` blocks Bash/Agent when `retro_pending: true`
- Retrospective: what went well → what was problematic → memory update → feedback
- `/consensus-loop:retrospect` extracts learnings (Quick/Full mode)
- `echo session-self-improvement-complete` → gate clears

## Headless Mode

All skills support headless execution (subagent context):
- **Never ask questions** — auto-select, auto-approve, auto-block
- Orchestrator: auto-select unblocked tasks by dependency order
- Retrospect: auto-approve threshold-met candidates, defer ambiguous
- Verify: exit code 0 (pass) / 1 (fail), no fix suggestions
- Merge: report result, no cleanup prompts

## Deterministic Tools (9)

Use tools before LLM reasoning — **facts first, inference second**.

| Tool | Purpose |
|------|---------|
| `code_map` | Symbol index with line ranges |
| `dependency_graph` | Import DAG, cycles, topological sort |
| `audit_scan` | Pattern scan (type-safety, hardcoded) |
| `coverage_map` | Per-file coverage % |
| `rtm_parse` | Parse RTM → structured rows |
| `rtm_merge` | Merge worktree RTMs |
| `audit_history` | Verdicts, rejection patterns |
| `fvm_generate` | Route × API × endpoint → FVM |
| `fvm_validate` | HTTP runner for FVM rows |

CLI: `node "${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs" <tool> --param value`
