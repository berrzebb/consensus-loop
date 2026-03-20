# Worker Lifecycle & Retrospective

## Retrospective & Merge

After `[agree_tag]` and worker WIP commit:

1. **Retrospective trigger**: `retro-marker.json` is set to `retro_pending: true`
   - `session-gate.mjs` blocks Bash/Agent until retrospective completes
   - Only Read/Write/Edit/Glob/Grep/TodoWrite allowed during retrospective
   - For worktree sub-agents: `subagent-stop.mjs` marks as `deferred_to_orchestrator`
2. **Perform retrospective** (see `templates/references/${locale}/retro-questions.md`):
   - What went well / What was problematic
   - **Audit accuracy review**: check for false positives/negatives
   - Memory update: invoke `/consensus-loop:retrospect` for structured extraction
   - Bidirectional feedback
3. **Rejection code improvement check**:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs" audit_history --summary --track <current-track>
   ```
   - FP rate >30% across 5+ rounds → flag for policy review
   - Same code 3+ times on track → suggest planner re-scoping
4. **Technical debt capture**: improvement items → `work-catalog.md` as `type: tech-debt`
5. **Release gate**: `echo session-self-improvement-complete` → marker resets
6. **Squash merge**: invoke `/consensus-loop:merge`
7. **Write session handoff**: update completed task status
8. **Loop**: return to Session Start

## Worker Lifecycle Gate

Every spawned agent must be tracked through its full lifecycle. **No agent may be abandoned.**

| # | Stage | Handoff Status | Verification |
|---|-------|---------------|-------------|
| 1 | Spawned | `in-progress` | `agent_id` + `worktree_path` recorded |
| 2 | Evidence submitted | `auditing` | Worker's watch_file contains `[trigger_tag]` |
| 3 | Audit complete | → `correcting` or → `done` | Respond file has verdict |
| 4 | Corrections (if rejected) | `correcting` | SendMessage sent to existing `agent_id` |
| 5 | Consensus reached | `done` (pending merge) | `[agree_tag]` in respond file |
| 6 | Retrospective | `done` (pending merge) | `retro_pending: false` |
| 7 | Merged | `done` | Squash commit in git log |

## Session End Audit

Before the orchestrator session ends, scan handoff for incomplete lifecycles:

```
For each task where status != "done" and status != "not-started":
  → Report: "[task-id] is in stage {N} ({status}). Action needed: {next step}"
```

**Prohibited session exits:**
- Any task with `agent_id` but no verdict processed → must process or report
- Any task with `[agree_tag]` but no WIP commit → must verify or report
- Any task with `[agree_tag]` + commit but no retrospective → must complete or defer
- Any task with retrospective done but no merge → must merge or report

## Session Summary (mandatory output)

```markdown
## Session Summary

| Task | Status | Stage | Next Action |
|------|--------|-------|-------------|
| [task-A] | done | 7/7 merged | — |
| [task-B] | correcting | 4/7 | Awaiting resubmission |
| [task-C] | in-progress | 1/7 | Worker running (agent_id: xxx) |

Handoff updated: {handoff_file_path}
```

### Headless Session End

In headless mode, the session summary is written to a file instead of presented:
- Write to `{handoff_dir}/session-summary-{timestamp}.md`
- Include all lifecycle statuses + deferred items
- The orchestrator that spawned this headless session reads the summary on completion
