# dependency_graph

Import/export dependency DAG with connected components, topological sort, and cycle detection. Results are mtime-cached.

## When to Use

- Work decomposition — components with no shared edges can be assigned to parallel workers
- Safe execution order — topological sort gives build/migration sequence
- Cycle detection — find circular dependencies before they cause issues
- Impact analysis — see which files import/are imported by a target

## Parameters

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `--path` | Yes | — | Directory or file to analyze |
| `--depth` | No | 5 | Max directory traversal depth |
| `--extensions` | No | `.ts,.tsx,.js,.jsx,.mjs,.mts` | File extensions to include |

## Examples

```bash
# Full dependency graph
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs dependency_graph --path src/

# Shallow scan
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs dependency_graph --path src/ --depth 2

# JSON output with structured data
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs dependency_graph --path src/ --json
```

## Output Sections

### Components
Connected components in the import graph. Files in the same component share dependencies. Singleton files (no imports/exports in scope) are listed separately.

### Dependencies Table
| File | Imports | Imported By |
|------|---------|-------------|

### Topological Order
Safe execution sequence — files listed from leaf (no dependencies) to root (most depended-on).

### Cycles Detected
Files with circular dependencies that cannot be topologically sorted.

### Isolated Files
Files with no import/export relationships within the scanned scope.

## JSON Output

With `--json`, returns:
```json
{
  "files": 42,
  "edges": 87,
  "components": 5,
  "cycles": 0
}
```

## Caching

Same mtime-based caching as code_map. Cache key includes path + depth.
