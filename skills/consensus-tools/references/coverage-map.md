# coverage_map

Maps test coverage data to files. Reads vitest coverage JSON and returns per-file statement/branch/function/line percentages.

## When to Use

- RTM coverage columns — fill in coverage data for traceability matrix
- Verification — check that changed files meet coverage thresholds (stmt ≥ 85%, branch ≥ 75%)
- Quality gates — identify under-tested files

## Prerequisites

Run coverage generation first:
```bash
npm run test:coverage
```
This produces `coverage/coverage-summary.json`.

## Parameters

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `--path` | No | — | Filter to files containing this path substring |
| `--coverage_dir` | No | `coverage` | Directory containing `coverage-summary.json` |

## Examples

```bash
# All files with coverage
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs coverage_map

# Filter to specific directory
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs coverage_map --path src/agent/

# Custom coverage directory
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs coverage_map --coverage_dir coverage-report/

# JSON output
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs coverage_map --path src/ --json
```

## Output Format

```
| File | Statements | Branches | Functions | Lines |
|------|-----------|----------|-----------|-------|
| src/agent/runner.ts | 92% | 85% | 88% | 91% |
| src/bus/redis.ts | 78% | 65% | 80% | 77% |

(12 files)
```

## Error Cases

- Missing `coverage-summary.json` → error with instructions to run `npm run test:coverage`
- No files matching filter → empty table with `0 files` summary
