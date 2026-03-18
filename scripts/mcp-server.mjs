#!/usr/bin/env node
/**
 * MCP Server — Exposes consensus-loop deterministic scripts as native tools.
 *
 * Tools:
 *   code_map    — Zero-token symbol index with caching + matrix output
 *   audit_scan  — Pattern scanner (type-safety, hardcoded, console, etc.)
 *
 * Protocol: JSON-RPC 2.0 over stdio (MCP standard)
 *
 * Configuration (.claude/settings.json or project settings):
 *   "mcpServers": {
 *     "consensus-loop": {
 *       "command": "node",
 *       "args": [".claude/hooks/consensus-loop/scripts/mcp-server.mjs"]
 *     }
 *   }
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, relative, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ═══ Cache ══════════════════════════════════════════════════════════════

const CACHE = new Map(); // key: `${path}|${filter}|${depth}` → { mtime, result }

function getCacheKey(path, filter, depth) {
  return `${path}|${filter || "all"}|${depth || 5}`;
}

function getLatestMtime(target) {
  const stat = statSync(target, { throwIfNoEntry: false });
  if (!stat) return 0;
  if (!stat.isDirectory()) return stat.mtimeMs;

  let latest = 0;
  try {
    for (const e of readdirSync(target, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const full = resolve(target, e.name);
      const t = e.isDirectory() ? getLatestMtime(full) : statSync(full).mtimeMs;
      if (t > latest) latest = t;
    }
  } catch { /* permission error */ }
  return latest;
}

// ═══ code-map engine ════════════════════════════════════════════════════

const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts"]);

const PATTERNS = [
  { type: "fn", re: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/m },
  { type: "fn", re: /^(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*(?:=>|:\s*\w)/m },
  { type: "fn", re: /^(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?function/m },
  { type: "method", re: /^\s+(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*[:{]/m },
  { type: "class", re: /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/m },
  { type: "iface", re: /^(?:export\s+)?interface\s+(\w+)/m },
  { type: "type", re: /^(?:export\s+)?type\s+(\w+)\s*[=<]/m },
  { type: "enum", re: /^(?:export\s+)?enum\s+(\w+)/m },
  { type: "import", re: /^import\s+(?:type\s+)?(?:\{([^}]+)\}|(\w+))\s+from\s+["']([^"']+)["']/m },
];

function findEndLine(lines, startIdx) {
  let depth = 0, started = false;
  for (let i = startIdx; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") { depth++; started = true; }
      if (ch === "}") depth--;
    }
    if (started && depth <= 0) return i + 1;
  }
  return startIdx + 1;
}

function parseFile(filePath, filters) {
  let content;
  try { content = readFileSync(filePath, "utf8"); } catch { return []; }
  const lines = content.split(/\r?\n/);
  const symbols = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) continue;

    for (const { type, re } of PATTERNS) {
      if (filters && !filters.has(type)) continue;
      const m = line.match(re);
      if (!m) continue;

      let name, detail = "";
      if (type === "import") {
        name = (m[1] || m[2] || "").trim();
        if (name.length > 40) name = name.slice(0, 37) + "...";
        detail = ` from "${m[3]}"`;
      } else {
        name = m[1] || "";
        if (m[2] !== undefined) {
          const p = m[2];
          detail = `(${p.length > 50 ? p.slice(0, 47) + "..." : p})`;
        }
      }

      const lineNum = i + 1;
      const endLine = findEndLine(lines, i);
      symbols.push({ line: lineNum, endLine, type, name, detail });
      break;
    }
  }
  return symbols;
}

function walkDir(dir, extensions, maxDepth, depth = 0) {
  if (depth > maxDepth) return [];
  const files = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "dist") continue;
    const full = resolve(dir, e.name);
    if (e.isDirectory()) files.push(...walkDir(full, extensions, maxDepth, depth + 1));
    else if (extensions.has(extname(e.name))) files.push(full);
  }
  return files;
}

// ═══ Matrix formatter ═══════════════════════════════════════════════════

function formatMatrix(fileSymbols, cwd) {
  const rows = [];
  let prevFile = "";

  for (const { file, symbols } of fileSymbols) {
    const rel = relative(cwd, file).replace(/\\/g, "/");
    if (symbols.length === 0) continue;

    // File header
    if (rel !== prevFile) {
      if (prevFile) rows.push(""); // blank line between files
      rows.push(`## ${rel} (${symbols.length})`);
      prevFile = rel;
    }

    // Aligned columns: Line | Type | Name
    for (const s of symbols) {
      const loc = s.endLine > s.line
        ? `L${s.line}-${s.endLine}`.padEnd(12)
        : `L${s.line}`.padEnd(12);
      const type = s.type.padEnd(7);
      rows.push(`  ${loc}${type}${s.name}${s.detail}`);
    }
  }

  return rows.join("\n");
}

// ═══ Overview matrix (birds-eye table) ══════════════════════════════════

function formatOverviewMatrix(fileSymbols, cwd) {
  const rows = [];
  rows.push("| File | Lines | fn | method | class | iface | type | enum |");
  rows.push("|------|------:|---:|-------:|------:|------:|-----:|-----:|");

  for (const { file, symbols } of fileSymbols) {
    const rel = relative(cwd, file).replace(/\\/g, "/");
    // Count lines
    let lineCount = 0;
    try { lineCount = readFileSync(file, "utf8").split("\n").length; } catch { /* skip */ }

    // Count by type
    const counts = { fn: 0, method: 0, class: 0, iface: 0, type: 0, enum: 0 };
    for (const s of symbols) {
      if (s.type in counts) counts[s.type]++;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (total === 0) continue;

    // Format cells — use dots for zero to reduce visual noise
    const cell = (n) => n > 0 ? String(n) : "·";
    rows.push(
      `| ${rel} | ${lineCount} | ${cell(counts.fn)} | ${cell(counts.method)} | ${cell(counts.class)} | ${cell(counts.iface)} | ${cell(counts.type)} | ${cell(counts.enum)} |`
    );
  }

  return rows.join("\n");
}

// ═══ Tool: code_map ═════════════════════════════════════════════════════

function toolCodeMap(params) {
  const { path: targetPath, filter, depth = 5 } = params;
  if (!targetPath) return { error: "path is required" };

  const target = resolve(targetPath);
  const stat = statSync(target, { throwIfNoEntry: false });
  if (!stat) return { error: `Not found: ${target}` };

  // Cache check
  const cacheKey = getCacheKey(targetPath, filter, depth);
  const latestMtime = getLatestMtime(target);
  const cached = CACHE.get(cacheKey);
  if (cached && cached.mtime >= latestMtime) {
    return { ...cached.result, cached: true };
  }

  const extensions = params.extensions
    ? new Set(params.extensions.split(","))
    : CODE_EXT;
  const filters = filter ? new Set(filter.split(",")) : null;
  const files = stat.isDirectory()
    ? walkDir(target, extensions, depth)
    : [target];

  const cwd = process.cwd();
  const fileSymbols = [];
  let totalSymbols = 0;

  for (const file of files.sort()) {
    const symbols = parseFile(file, filters);
    fileSymbols.push({ file, symbols });
    totalSymbols += symbols.length;
  }

  const format = params.format || "detail";
  const text = format === "matrix"
    ? formatOverviewMatrix(fileSymbols, cwd)
    : formatMatrix(fileSymbols, cwd);
  const summary = `${files.length} files, ${totalSymbols} symbols`;
  const result = { text, summary };

  // Cache store
  CACHE.set(cacheKey, { mtime: latestMtime, result });

  return result;
}

// ═══ Tool: audit_scan ═══════════════════════════════════════════════════

function toolAuditScan(params) {
  const { pattern = "all", path: targetPath } = params;
  const scriptPath = resolve(__dirname, "audit-scan.mjs");
  if (!existsSync(scriptPath)) return { error: "audit-scan.mjs not found" };

  try {
    const args = [scriptPath, pattern];
    if (targetPath) args.push(targetPath);
    const output = execFileSync(process.execPath, args, {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 30000,
    });
    return { text: output.trim() };
  } catch (err) {
    return { error: err.message, stdout: err.stdout?.trim() };
  }
}

// ═══ MCP Protocol ═══════════════════════════════════════════════════════

const SERVER_INFO = { name: "consensus-loop", version: "2.2.0" };

const TOOLS = [
  {
    name: "code_map",
    description: "Generate a cached, matrix-formatted symbol index for a directory or file. Returns function/class/type declarations with line ranges, grouped by file. Results are cached — repeated calls for unchanged files cost zero. Use before Read to know exactly which lines to target.",
    inputSchema: {
      type: "object",
      properties: {
        path:       { type: "string", description: "File or directory path to scan" },
        filter:     { type: "string", description: "Comma-separated types: fn, method, class, iface, type, enum, import" },
        depth:      { type: "number", description: "Max directory depth (default: 5)" },
        extensions: { type: "string", description: "File extensions (default: .ts,.tsx,.js,.jsx,.mjs,.mts)" },
        format:     { type: "string", enum: ["detail", "matrix"], description: "Output format: detail (grouped symbols) or matrix (overview table with counts)" },
      },
      required: ["path"],
    },
  },
  {
    name: "audit_scan",
    description: "Run zero-token pattern scan. Detects type-safety issues (as any, @ts-ignore), hardcoded strings, console.log, and other anti-patterns.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Scan pattern: all, type-safety, hardcoded, console" },
        path:    { type: "string", description: "Target path to scan" },
      },
    },
  },
];

function handleRequest(req) {
  switch (req.method) {
    case "initialize":
      return {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      };

    case "tools/list":
      return { tools: TOOLS };

    case "tools/call": {
      const { name, arguments: args } = req.params;

      if (name === "code_map") {
        const result = toolCodeMap(args || {});
        if (result.error) {
          return { content: [{ type: "text", text: result.error }], isError: true };
        }
        const tag = result.cached ? " [cached]" : "";
        return { content: [{ type: "text", text: `${result.text}\n\n(${result.summary}${tag})` }] };
      }

      if (name === "audit_scan") {
        const result = toolAuditScan(args || {});
        if (result.error) {
          return { content: [{ type: "text", text: result.stdout || result.error }], isError: true };
        }
        return { content: [{ type: "text", text: result.text }] };
      }

      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }

    case "notifications/initialized":
    case "notifications/cancelled":
      return null;

    default:
      return null; // ignore unknown methods silently
  }
}

// ═══ stdio transport ════════════════════════════════════════════════════

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on("line", (line) => {
  if (!line.trim()) return;
  let req;
  try { req = JSON.parse(line); } catch { return; }

  const result = handleRequest(req);
  if (result === null || req.id === undefined) return;

  const response = { jsonrpc: "2.0", id: req.id };
  if (result.error?.code) {
    response.error = result.error;
  } else {
    response.result = result;
  }
  process.stdout.write(JSON.stringify(response) + "\n");
});

rl.on("close", () => process.exit(0));
