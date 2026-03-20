# Multi-Track Distribution

## Scope Validation (non-overlap check)

Before parallel distribution, verify no scope conflicts:

1. **Estimate file scope**: Extract target files/directories from each task's description
2. **Detect overlap**: If the same file appears in 2+ tasks → **serialize** them
3. **Directory-level conflict**: Tasks touching the same directory → warn
4. **Safe parallel**: Only tasks touching different modules/directories run in parallel

## Parallel Spawn

Issue multiple Agent tool calls in a single message:

```json
// Agent tool call 1
{
  "prompt": "[task-A context + handoff section + done-criteria]",
  "subagent_type": "consensus-loop:implementer",
  "isolation": "worktree",
  "run_in_background": true,
  "description": "implement task-A"
}

// Agent tool call 2 (same message)
{
  "prompt": "[task-B context + handoff section + done-criteria]",
  "subagent_type": "consensus-loop:implementer",
  "isolation": "worktree",
  "run_in_background": true,
  "description": "implement task-B"
}
```

- **Always use `run_in_background: true`** — orchestrator is freed immediately
- Each agent runs in an isolated worktree
- Record each `agentId` in handoff on return
- Maximum 3 concurrent agents (rate limit prevention)

## Track Closure Protocol (Pre-Close Scout)

Before declaring any track "done" in the handoff:

1. **Re-run scout** on the track — verify ALL Forward RTM rows
2. **Check for partial-wiring** — `dependency_graph` must show actual import edges for every ✅ row
3. **Verify Gap Summary is empty** — if gaps remain, they appear in handoff with status
4. **Never write "전체 완료"** — use precise gap counts instead

### Impl Status Awareness

| Status | Meaning | Track Closable? |
|--------|---------|-----------------|
| ⚠️ partial-impl | Core logic exists, minor gaps | Yes, if gaps are in Residual Risk |
| 🔌 partial-wiring | Code exists but disconnected (no import) | **No** — wiring is required |

`partial-wiring` rows MUST be resolved before track closure.
