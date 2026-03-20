---
name: consensus-loop:tools
description: "Run consensus-loop deterministic analysis tools via CLI — code_map, dependency_graph, audit_scan, coverage_map, rtm_parse, rtm_merge, audit_history, fvm_generate, fvm_validate. Use this skill whenever you need codebase analysis (symbol index, dependency DAG, pattern scan, coverage), RTM operations (parse, merge, query), or FVM operations (generate matrix, validate against server) — even if the MCP server is not configured. This skill replaces mcp__plugin_consensus-loop_consensus-loop__* tool calls with equivalent CLI commands."
argument-hint: "<tool_name> [context or parameters]"
allowed-tools: Read, Bash(node *), Bash(git *)
---

# consensus-loop:tools

CLI interface for the 9 deterministic analysis tools that power the consensus-loop workflow. These tools run via `tool-runner.mjs` — same logic as the MCP server, but invoked through Bash instead of JSON-RPC.

## Tool Runner Path

```
${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs
```

Invocation pattern:
```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs <tool_name> --param value ...
```

Add `--json` to any command for structured JSON output instead of formatted text.

## Tool Selection Guide

| Need | Tool | Reference |
|------|------|-----------|
| Find functions/classes/types with line ranges | `code_map` | [code-map.md](references/code-map.md) |
| Map import/export dependencies, detect cycles | `dependency_graph` | [dependency-graph.md](references/dependency-graph.md) |
| Scan for `as any`, hardcoded values, console.log | `audit_scan` | [audit-scan.md](references/audit-scan.md) |
| Get per-file test coverage percentages | `coverage_map` | [coverage-map.md](references/coverage-map.md) |
| Read RTM rows, filter by req_id or status | `rtm_parse` | [rtm-parse.md](references/rtm-parse.md) |
| Merge worktree RTM files into base | `rtm_merge` | [rtm-merge.md](references/rtm-merge.md) |
| Query audit verdict history, detect patterns | `audit_history` | [audit-history.md](references/audit-history.md) |
| Generate FE×API×BE×Auth verification matrix | `fvm_generate` | [fvm-generate.md](references/fvm-generate.md) |
| Execute FVM rows against live server | `fvm_validate` | [fvm-validate.md](references/fvm-validate.md) |

## Workflow

1. Identify which tool matches the user's need using the table above
2. Read the corresponding reference file for detailed parameters and examples
3. Run the tool via `node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs`
4. Parse the output (text to stdout, summary to stderr)

## Quick Examples

```bash
# Symbol index for a directory
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs code_map --path src/

# Dependency graph with cycle detection
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs dependency_graph --path src/ --depth 3

# Pattern scan for type-safety issues
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs audit_scan --pattern type-safety

# Parse RTM, filter by requirement ID
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs rtm_parse --path docs/rtm.md --req_id EV-1

# Audit history summary with risk patterns
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs audit_history --summary

# FVM generation
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs fvm_generate --path /project/root
```

## Error Handling

- Exit code 0 = success (text to stdout, summary to stderr)
- Exit code 1 = error (message to stderr)
- Missing required params → error message lists what's needed
- `--json` flag outputs structured JSON for programmatic use

## MCP ↔ CLI Equivalence

Every MCP tool call maps 1:1 to a CLI command:

| MCP Call | CLI Equivalent |
|----------|---------------|
| `mcp__consensus-loop__code_map({path: "src/"})` | `node tool-runner.mjs code_map --path src/` |
| `mcp__consensus-loop__dependency_graph({path: "src/"})` | `node tool-runner.mjs dependency_graph --path src/` |
| `mcp__consensus-loop__audit_scan({pattern: "all"})` | `node tool-runner.mjs audit_scan --pattern all` |
| `mcp__consensus-loop__rtm_parse({path: "x.md"})` | `node tool-runner.mjs rtm_parse --path x.md` |

The output format is identical — same text, same summary.
