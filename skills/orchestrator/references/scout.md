# Scout Phase (RTM Generation)

Before distributing work, dispatch a **scout** to produce a Requirements Traceability Matrix (RTM).

The RTM is the **single source of truth** that all agents share. It eliminates redundant exploration.

## Flow

```
Orchestrator selects track(s)
    ↓
Scout reads: execution-order → README → work-breakdown → codebase
    ↓
Produces 3 matrices:
  Forward RTM   — requirement → code → test (gap detection)
  Backward RTM  — test → code → requirement (orphan detection)
  Bidirectional — cross-reference summary (coverage analysis)
    ↓
Orchestrator distributes Forward RTM rows to implementers
```

## Procedure

1. **Spawn scout agent** — read-only, thorough analysis (Opus):
   ```json
   {
     "prompt": "[target tracks + design doc paths]",
     "subagent_type": "scout",
     "description": "scout RTM for [track-name]"
   }
   ```
   Scout agent definition: `agents/scout.md`
   RTM format: `${CLAUDE_PLUGIN_ROOT}/templates/references/${locale}/traceability-matrix.md`

2. **Receive 3 matrices**:
   - **Forward RTM**: Req ID × File with Exists/Impl/Test Case/Connected columns
   - **Backward RTM**: Existing tests traced back to requirements (orphan detection)
   - **Bidirectional summary**: Gap analysis

3. **Use Forward RTM to**:
   - Identify open rows (⬜) → work items to distribute
   - Validate non-overlapping file scopes for parallel distribution
   - Assign rows to implementers by Req ID grouping

4. **Use Backward RTM to**:
   - Detect orphan tests/code for cleanup
   - Verify connection chains across tracks

## RTM Staleness Check

Before distributing from an existing RTM:

1. Compare `work-breakdown.md` mtime vs `rtm-{domain}.md` mtime
2. If work-breakdown is newer → **RTM is stale** → re-run scout
3. If execution-order.md is newer → cross-track connections may be invalid → re-run scout

## When to Skip Scout

- RTM exists AND work-breakdown.md mtime < RTM mtime (fresh)
- Correction round (Forward RTM rows already identified by auditor)
- Single-file trivial change

## RTM Tools via CLI

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs" rtm_parse --path <rtm.md> --status open
node "${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs" rtm_merge --base <base.md> --updates '["wt1.md","wt2.md"]'
```
