#!/usr/bin/env node
/**
 * tool-runner.mjs — CLI entry point for consensus-loop tools.
 *
 * Provides the same functionality as the MCP server (mcp-server.mjs)
 * but invoked via command line instead of JSON-RPC.
 *
 * Usage:
 *   node tool-runner.mjs <tool-name> [--param value ...]
 *   node tool-runner.mjs code_map --path src/
 *   node tool-runner.mjs dependency_graph --path src/ --depth 3
 *   node tool-runner.mjs audit_scan --pattern type-safety
 *   node tool-runner.mjs rtm_parse --path docs/rtm.md --matrix forward
 *   node tool-runner.mjs rtm_merge --base docs/rtm.md --updates '["wt1/rtm.md","wt2/rtm.md"]'
 *   node tool-runner.mjs audit_history --summary
 *   node tool-runner.mjs coverage_map --path src/
 *   node tool-runner.mjs fvm_generate --path /project/root --format full
 *   node tool-runner.mjs fvm_validate --fvm_path docs/fvm.md --base_url http://localhost:4200 --credentials '{"admin":{"username":"a","password":"b"}}'
 *
 * Output: tool result text to stdout, summary to stderr.
 * Exit code: 0 on success, 1 on error.
 */
import {
  toolCodeMap,
  toolAuditScan,
  toolCoverageMap,
  toolDependencyGraph,
  toolRtmParse,
  toolRtmMerge,
  toolAuditHistory,
  generateFvm,
  runFvmValidation,
  TOOL_NAMES,
} from "./tool-core.mjs";

// ═══ CLI argument parser ════════════════════════════════════════════════

function parseArgs(args) {
  const params = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith("--")) continue;
    const key = args[i].slice(2);
    const val = args[i + 1];

    if (!val || val.startsWith("--")) {
      // Boolean flag
      params[key] = true;
      continue;
    }

    // JSON values (arrays, objects)
    if (val.startsWith("[") || val.startsWith("{")) {
      try { params[key] = JSON.parse(val); } catch { params[key] = val; }
    }
    // Boolean literals
    else if (val === "true") params[key] = true;
    else if (val === "false") params[key] = false;
    // Numbers
    else if (/^\d+$/.test(val)) params[key] = parseInt(val, 10);
    // Strings
    else params[key] = val;

    i++;
  }
  return params;
}

// ═══ Tool dispatcher ════════════════════════════════════════════════════

const DISPATCH = {
  code_map:         (p) => toolCodeMap(p),
  audit_scan:       (p) => toolAuditScan(p),
  coverage_map:     (p) => toolCoverageMap(p),
  dependency_graph: (p) => toolDependencyGraph(p),
  rtm_parse:        (p) => toolRtmParse(p),
  rtm_merge:        (p) => toolRtmMerge(p),
  audit_history:    (p) => toolAuditHistory(p),
  fvm_generate:     (p) => generateFvm(p.path, p.format),
  fvm_validate:     (p) => runFvmValidation(p),
};

// ═══ Help text ══════════════════════════════════════════════════════════

const HELP = `
consensus-loop tool runner — CLI interface for deterministic analysis tools.

Usage: node tool-runner.mjs <tool> [--param value ...]

Tools:
  code_map          Symbol index (fn/class/type/import) with line ranges
                    --path <dir|file> [--filter fn,class] [--depth N] [--format detail|matrix]

  dependency_graph  Import/export DAG, components, topological sort, cycles
                    --path <dir|file> [--depth N] [--extensions .ts,.mjs]

  audit_scan        Pattern scanner (type-safety, hardcoded, console, etc.)
                    [--pattern all|type-safety|hardcoded|console] [--path <dir>]

  coverage_map      Per-file coverage from vitest JSON
                    [--path <filter>] [--coverage_dir coverage/]

  rtm_parse         Parse RTM markdown → structured rows
                    --path <rtm.md> [--matrix forward|backward|bidirectional] [--req_id EV-1] [--status open]

  rtm_merge         Row-level merge of worktree RTMs
                    --base <rtm.md> --updates '["wt1.md","wt2.md"]'

  audit_history     Query persistent audit history log
                    [--path <jsonl>] [--track name] [--code RC] [--since ISO] [--summary]

  fvm_generate      FE route × API × BE endpoint → FVM table
                    --path <project-root> [--format full|mismatches|matrix]

  fvm_validate      Execute FVM rows against live server
                    --fvm_path <fvm.md> --base_url <url> --credentials '{"role":{"username":"u","password":"p"}}'
                    [--filter_role <role>] [--filter_route <route>] [--timeout_ms N]

Options:
  --help            Show this help message
  --json            Output raw JSON instead of formatted text
`.trim();

// ═══ Main ═══════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help")) {
    console.log(HELP);
    process.exit(0);
  }

  const toolName = args[0];
  if (!DISPATCH[toolName]) {
    console.error(`Unknown tool: ${toolName}`);
    console.error(`Available: ${TOOL_NAMES.join(", ")}`);
    process.exit(1);
  }

  const params = parseArgs(args.slice(1));
  const jsonOutput = params.json;
  delete params.json;

  const result = await DISPATCH[toolName](params);

  if (result.error) {
    console.error(`Error: ${result.error}`);
    if (result.stdout) console.log(result.stdout);
    process.exit(1);
  }

  if (jsonOutput) {
    console.log(JSON.stringify(result.json || { text: result.text, summary: result.summary }, null, 2));
  } else {
    console.log(result.text);
    if (result.summary) console.error(`\n(${result.summary})`);
  }
}

main();
