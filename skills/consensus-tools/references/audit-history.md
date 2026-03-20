# audit_history

Query the persistent audit history log (JSONL). Returns verdict timelines, rejection code frequency, track distribution, and risk pattern detection.

## When to Use

- Cross-session quality analysis — track approval rate trends
- Identify structural issues — find rejection codes appearing 3+ times
- Planning — check which tracks have most rejections before allocating work
- Retrospective input — feed audit patterns into improvement decisions

## Parameters

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `--path` | No | `.claude/audit-history.jsonl` | Path to the JSONL history file |
| `--track` | No | — | Filter by track name (substring match) |
| `--code` | No | — | Filter by rejection code (substring match) |
| `--since` | No | — | ISO timestamp — only entries after this time |
| `--summary` | No | `false` | Aggregate statistics instead of detail rows |

## Examples

```bash
# Recent audit entries (last 50)
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs audit_history

# Summary with risk patterns
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs audit_history --summary

# Filter by track
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs audit_history --track event-bus

# Filter by rejection code
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs audit_history --code CQ

# Entries since a specific date
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs audit_history --since 2026-03-15T00:00:00Z

# JSON output
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs audit_history --summary --json
```

## Output Modes

### Detail mode (default)
Shows last 50 entries as a table:
```
| Timestamp | Track | Verdict | Req IDs | Rejection Codes |
|-----------|-------|---------|---------|-----------------|
| 2026-03-19 14:30 | event-bus | pending | EV-1,EV-2 | CQ[major] |
```

### Summary mode (`--summary`)
Aggregate statistics:
```
## Audit History Summary

- Total entries: 24
- Agree: 18, Pending: 6
- Approval rate: 75%

### By Track
| Track | Entries |
|-------|--------|

### By Rejection Code
| Code | Count |
|------|-------|

### Risk Patterns
- ⚠️ `CQ` appeared 5 times — structural issue likely
```

## Risk Pattern Detection

Codes appearing 3+ times are flagged as structural issues — these suggest a systemic problem rather than one-off mistakes.

## JSON Output (summary)

```json
{
  "total": 24,
  "byVerdict": { "agree": 18, "pending": 6 },
  "byTrack": { "event-bus": 12, "auth": 8 },
  "byCode": { "CQ": 5, "T": 3 }
}
```
