# code_map

Zero-token symbol index with mtime-based caching. Extracts function, class, interface, type, enum, and import declarations with line ranges.

## When to Use

- Before `Read` — find exact line ranges to target instead of reading entire files
- Codebase exploration — get a birds-eye view of a directory's structure
- Work decomposition — identify which files contain which symbols

## Parameters

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `--path` | Yes | — | File or directory to scan |
| `--filter` | No | all | Comma-separated: `fn,method,class,iface,type,enum,import` |
| `--depth` | No | 5 | Max directory traversal depth |
| `--extensions` | No | `.ts,.tsx,.js,.jsx,.mjs,.mts` | File extensions to include |
| `--format` | No | `detail` | `detail` (grouped symbols) or `matrix` (overview table) |

## Examples

```bash
# All symbols in a directory
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs code_map --path src/agent/

# Functions and classes only
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs code_map --path src/ --filter fn,class

# Overview table with counts per file
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs code_map --path src/ --format matrix

# Single file
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs code_map --path src/bus/redis.ts

# JSON output for programmatic use
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs code_map --path src/ --json
```

## Output Format

### Detail mode (default)
```
## src/bus/redis.ts (5)
  L45-L78     fn     createClient(opts)
  L80-L92     fn     disconnect()
  L12         import { Router } from "express"

## src/agent/index.ts (3)
  L12-L45     class  AgentRunner
  L5          import { Router } from "express"
```

### Matrix mode
```
| File | Lines | fn | method | class | iface | type | enum |
|------|------:|---:|-------:|------:|------:|-----:|-----:|
| src/bus/redis.ts | 120 | 3 | 2 | · | · | 1 | · |
```

## Caching

Results are cached by path + filter + depth. Cache invalidates when any file's mtime changes. Repeated calls for unchanged files return instantly with `[cached]` tag.
