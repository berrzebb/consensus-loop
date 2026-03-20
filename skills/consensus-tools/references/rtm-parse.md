# rtm_parse

Parse RTM (Requirements Traceability Matrix) markdown files into structured rows. Supports forward, backward, and bidirectional matrices with filtering.

## When to Use

- Read RTM state — check requirement coverage, find gaps
- Distribute work — filter rows by status to find open items
- Verify updates — check specific req_id rows after implementation
- Scout input — provide structured RTM data for analysis

## Parameters

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `--path` | Yes | — | Path to RTM markdown file |
| `--matrix` | No | `forward` | `forward`, `backward`, or `bidirectional` |
| `--req_id` | No | — | Filter rows by Req ID prefix (e.g., `EV-1`) |
| `--status` | No | — | Filter rows by status (e.g., `open`, `fixed`, `verified`) |

## Examples

```bash
# Parse forward RTM
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs rtm_parse --path docs/plan/track-1/rtm.md

# Filter by requirement ID
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs rtm_parse --path docs/rtm.md --req_id EV-1

# Open items only
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs rtm_parse --path docs/rtm.md --status open

# Backward RTM (test → code → requirement)
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs rtm_parse --path docs/rtm.md --matrix backward

# JSON output with structured row objects
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs rtm_parse --path docs/rtm.md --json
```

## Matrix Types

| Type | Direction | Purpose |
|------|-----------|---------|
| `forward` | Requirement → Code → Test | Gap detection (what's not implemented?) |
| `backward` | Test → Code → Requirement | Orphan detection (tests without requirements?) |
| `bidirectional` | Cross-reference summary | Coverage analysis |

## Output Format

Text output reproduces the filtered table:
```
## forward RTM — 15 rows (filtered: EV-1)

| Req ID | Description | Track | ... | Status |
|--------|-------------|-------|-----|--------|
| EV-1.1 | Event bus init | T1 | ... | fixed |

**Status summary**: fixed: 10, open: 3, verified: 2
```

## JSON Output

```json
{
  "matrix": "forward",
  "total": 42,
  "filtered": 15,
  "rows": [
    { "req_id": "EV-1.1", "description": "Event bus init", "status": "fixed", ... }
  ]
}
```

## Section Detection

The parser looks for `## Forward RTM` / `## 순방향 RTM` headings (Korean supported). If no section header is found, it parses the entire file as a table.
