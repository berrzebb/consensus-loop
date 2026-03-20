# rtm_merge

Row-level merge of multiple worktree RTM files into a base RTM. Detects conflicts, applies updates, appends discovered rows.

## When to Use

- After parallel workers complete — merge their RTM updates back to main
- Before squash merge — consolidate worktree RTMs into the base
- Orchestrator workflow — combine scout/implementer RTM contributions

## Parameters

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `--base` | Yes | — | Path to the base RTM file (main repo) |
| `--updates` | Yes | — | JSON array of paths to worktree RTM files |

## Examples

```bash
# Merge two worktree RTMs
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs rtm_merge \
  --base docs/plan/track-1/rtm.md \
  --updates '["../wt-worker-1/docs/plan/track-1/rtm.md","../wt-worker-2/docs/plan/track-1/rtm.md"]'

# JSON output for programmatic use
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs rtm_merge \
  --base docs/rtm.md \
  --updates '["wt1/rtm.md"]' \
  --json
```

## Merge Logic

Rows are keyed by `Req ID × File`:

1. **New row** (key not in base) → appended as discovered
2. **Updated row** (key exists, content differs, single source) → applied
3. **Conflict** (key modified by two different workers) → flagged for manual resolution
4. **Unchanged row** → preserved as-is

## Output Sections

### Summary
- Base path, update count, total rows, updates applied, additions, conflicts

### Conflicts (if any)
Shows both versions for manual resolution:
```
- **EV-1.1|src/bus.ts**: modified by `wt1/rtm.md` and `wt2/rtm.md`
  - Source 1: | EV-1.1 | ... | fixed |
  - Source 2: | EV-1.1 | ... | verified |
```

### Updated Rows / New Rows
Tables showing what changed and where it came from.

### Merged Forward RTM
The complete merged table — can be written directly to the base file.

## JSON Output

```json
{
  "total": 45,
  "updated": 8,
  "added": 3,
  "conflicts": 1
}
```
