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

// ═══ Tool: coverage_map ═════════════════════════════════════════════════

function loadCoverageSummary(coverageDir) {
  const summaryPath = resolve(coverageDir, "coverage-summary.json");
  if (!existsSync(summaryPath)) return null;
  const raw = JSON.parse(readFileSync(summaryPath, "utf8"));
  const result = new Map();
  for (const [filePath, data] of Object.entries(raw)) {
    if (filePath === "total") continue;
    result.set(filePath.replace(/\\/g, "/"), {
      statements: data.statements?.pct ?? 0,
      branches: data.branches?.pct ?? 0,
      functions: data.functions?.pct ?? 0,
      lines: data.lines?.pct ?? 0,
    });
  }
  return result;
}

function toolCoverageMap(params) {
  const { path: targetPath, coverage_dir: covDir = "coverage" } = params;
  const cwd = process.cwd();
  const coverageMap = loadCoverageSummary(resolve(cwd, covDir));
  if (!coverageMap) return { error: `No coverage data at ${resolve(cwd, covDir, "coverage-summary.json")}. Run: npm run test:coverage` };

  // If a specific path is given, filter to files under that path
  const filter = targetPath ? targetPath.replace(/\\/g, "/") : null;
  const rows = [];
  rows.push("| File | Statements | Branches | Functions | Lines |");
  rows.push("|------|-----------|----------|-----------|-------|");

  let count = 0;
  for (const [filePath, data] of [...coverageMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const rel = relative(cwd, filePath).replace(/\\/g, "/");
    if (filter && !rel.includes(filter) && !filePath.includes(filter)) continue;
    rows.push(`| ${rel} | ${data.statements}% | ${data.branches}% | ${data.functions}% | ${data.lines}% |`);
    count++;
  }

  return { text: rows.join("\n"), summary: `${count} files` };
}

// ═══ Tool: dependency_graph ═════════════════════════════════════════════

const IMPORT_RE = /^import\s+(?:type\s+)?(?:\{[^}]*\}|\w+|\*\s+as\s+\w+)(?:\s*,\s*(?:\{[^}]*\}|\w+))?\s+from\s+["']([^"']+)["']/;
const REQUIRE_RE = /(?:require|import)\s*\(\s*["']([^"']+)["']\s*\)/;
const EXPORT_FROM_RE = /^export\s+(?:type\s+)?\{[^}]*\}\s+from\s+["']([^"']+)["']/;
const DYNAMIC_IMPORT_RE = /import\s*\(\s*["']([^"']+)["']\s*\)/;

function extractImports(filePath) {
  let content;
  try { content = readFileSync(filePath, "utf8"); } catch { return []; }
  const imports = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    for (const re of [IMPORT_RE, EXPORT_FROM_RE, REQUIRE_RE, DYNAMIC_IMPORT_RE]) {
      const m = trimmed.match(re);
      if (m && m[1]) {
        imports.push(m[1]);
        break;
      }
    }
  }
  return imports;
}

function resolveImportPath(fromFile, specifier, extensions) {
  if (specifier.startsWith(".")) {
    const base = resolve(dirname(fromFile), specifier);
    // Try exact, then with extensions, then as directory index
    if (existsSync(base) && statSync(base).isFile()) return base;
    for (const ext of extensions) {
      const withExt = base + ext;
      if (existsSync(withExt)) return withExt;
    }
    for (const ext of extensions) {
      const index = resolve(base, "index" + ext);
      if (existsSync(index)) return index;
    }
  }
  return null; // external package — not tracked
}

function buildDependencyGraph(targetPath, maxDepth, extensions) {
  const target = resolve(targetPath);
  const stat_ = statSync(target, { throwIfNoEntry: false });
  if (!stat_) return { error: `Not found: ${target}` };

  const extSet = extensions
    ? new Set(extensions.split(","))
    : CODE_EXT;
  const extArr = [...extSet];

  const files = stat_.isDirectory()
    ? walkDir(target, extSet, maxDepth)
    : [target];

  const cwd = process.cwd();
  const fileSet = new Set(files.map(f => f.replace(/\\/g, "/")));

  // Build adjacency list: file → [files it imports]
  const edges = new Map();   // file → Set<file>
  const inEdges = new Map(); // file → Set<file> (reverse)

  for (const file of files) {
    const norm = file.replace(/\\/g, "/");
    if (!edges.has(norm)) edges.set(norm, new Set());
    if (!inEdges.has(norm)) inEdges.set(norm, new Set());

    const imports = extractImports(file);
    for (const spec of imports) {
      const resolved = resolveImportPath(file, spec, extArr);
      if (!resolved) continue;
      const resolvedNorm = resolved.replace(/\\/g, "/");
      if (!fileSet.has(resolvedNorm)) continue; // outside scope

      edges.get(norm).add(resolvedNorm);
      if (!inEdges.has(resolvedNorm)) inEdges.set(resolvedNorm, new Set());
      inEdges.get(resolvedNorm).add(norm);
    }
  }

  // Topological sort (Kahn's algorithm)
  const inDegree = new Map();
  for (const f of files) {
    const norm = f.replace(/\\/g, "/");
    inDegree.set(norm, (inEdges.get(norm) || new Set()).size);
  }
  const queue = [];
  for (const [f, deg] of inDegree) {
    if (deg === 0) queue.push(f);
  }
  const topoOrder = [];
  const visited = new Set();
  while (queue.length > 0) {
    const f = queue.shift();
    if (visited.has(f)) continue;
    visited.add(f);
    topoOrder.push(f);
    for (const dep of (edges.get(f) || [])) {
      inDegree.set(dep, (inDegree.get(dep) || 1) - 1);
      if (inDegree.get(dep) === 0) queue.push(dep);
    }
  }
  // Files in cycles won't appear in topoOrder
  const cycleFiles = files.map(f => f.replace(/\\/g, "/")).filter(f => !visited.has(f));

  // Connected components (undirected)
  const componentOf = new Map();
  let componentId = 0;
  const undirectedAdj = new Map();
  for (const f of files) {
    const norm = f.replace(/\\/g, "/");
    if (!undirectedAdj.has(norm)) undirectedAdj.set(norm, new Set());
    for (const dep of (edges.get(norm) || [])) {
      undirectedAdj.get(norm).add(dep);
      if (!undirectedAdj.has(dep)) undirectedAdj.set(dep, new Set());
      undirectedAdj.get(dep).add(norm);
    }
  }
  const compVisited = new Set();
  const components = [];
  for (const f of files) {
    const norm = f.replace(/\\/g, "/");
    if (compVisited.has(norm)) continue;
    const comp = [];
    const stack = [norm];
    while (stack.length > 0) {
      const n = stack.pop();
      if (compVisited.has(n)) continue;
      compVisited.add(n);
      comp.push(n);
      componentOf.set(n, componentId);
      for (const neighbor of (undirectedAdj.get(n) || [])) {
        if (!compVisited.has(neighbor)) stack.push(neighbor);
      }
    }
    components.push(comp);
    componentId++;
  }

  // Format output
  const rows = [];
  const totalEdges = [...edges.values()].reduce((s, e) => s + e.size, 0);

  // Component summary
  rows.push("## Components\n");
  rows.push(`${components.length} connected components, ${files.length} files, ${totalEdges} edges\n`);
  for (let i = 0; i < components.length; i++) {
    const comp = components[i];
    if (comp.length === 1) continue; // skip singletons in summary
    rows.push(`### Component ${i} (${comp.length} files)`);
    for (const f of comp.sort()) {
      rows.push(`  ${relative(cwd, f).replace(/\\/g, "/")}`);
    }
    rows.push("");
  }

  // Dependency table (non-singleton files only)
  const connectedFiles = files
    .map(f => f.replace(/\\/g, "/"))
    .filter(f => (edges.get(f)?.size || 0) > 0 || (inEdges.get(f)?.size || 0) > 0);

  if (connectedFiles.length > 0) {
    rows.push("## Dependencies\n");
    rows.push("| File | Imports | Imported By |");
    rows.push("|------|---------|-------------|");
    for (const f of connectedFiles.sort()) {
      const rel = relative(cwd, f).replace(/\\/g, "/");
      const deps = [...(edges.get(f) || [])].map(d => relative(cwd, d).replace(/\\/g, "/"));
      const revs = [...(inEdges.get(f) || [])].map(d => relative(cwd, d).replace(/\\/g, "/"));
      rows.push(`| ${rel} | ${deps.join(", ") || "—"} | ${revs.join(", ") || "—"} |`);
    }
    rows.push("");
  }

  // Topological order (leaf → root)
  if (topoOrder.length > 0) {
    rows.push("## Topological Order (safe execution sequence)\n");
    for (let i = 0; i < topoOrder.length; i++) {
      rows.push(`${i + 1}. ${relative(cwd, topoOrder[i]).replace(/\\/g, "/")}`);
    }
    rows.push("");
  }

  // Cycles
  if (cycleFiles.length > 0) {
    rows.push("## Cycles Detected\n");
    rows.push("These files have circular dependencies and cannot be topologically sorted:\n");
    for (const f of cycleFiles.sort()) {
      rows.push(`- ${relative(cwd, f).replace(/\\/g, "/")}`);
    }
  }

  // Singletons (isolated files)
  const singletons = components.filter(c => c.length === 1);
  if (singletons.length > 0) {
    rows.push(`\n## Isolated Files (${singletons.length})\n`);
    rows.push("No imports from/to other files in scope.\n");
  }

  return {
    text: rows.join("\n"),
    summary: `${files.length} files, ${totalEdges} edges, ${components.length} components` +
      (cycleFiles.length > 0 ? `, ${cycleFiles.length} in cycles` : ""),
    json: {
      files: files.length,
      edges: totalEdges,
      components: components.length,
      cycles: cycleFiles.length,
    },
  };
}

function toolDependencyGraph(params) {
  const { path: targetPath, depth = 5, extensions } = params;
  if (!targetPath) return { error: "path is required" };

  // Cache check
  const cacheKey = getCacheKey(targetPath, "depgraph", depth);
  const target = resolve(targetPath);
  const latestMtime = getLatestMtime(target);
  const cached = CACHE.get(cacheKey);
  if (cached && cached.mtime >= latestMtime) {
    return { ...cached.result, cached: true };
  }

  const result = buildDependencyGraph(targetPath, depth, extensions);
  if (result.error) return result;

  CACHE.set(cacheKey, { mtime: latestMtime, result });
  return result;
}

// ═══ MCP Protocol ═══════════════════════════════════════════════════════

const SERVER_INFO = { name: "consensus-loop", version: "2.3.0" };

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
  {
    name: "dependency_graph",
    description: "Build a cached import/export dependency graph for a directory. Returns connected components (natural work boundaries), topological order (safe execution sequence), dependency table (imports/imported-by per file), and cycle detection. Use for work decomposition — components that share no edges can be assigned to parallel workers.",
    inputSchema: {
      type: "object",
      properties: {
        path:       { type: "string", description: "Directory or file to analyze" },
        depth:      { type: "number", description: "Max directory depth (default: 5)" },
        extensions: { type: "string", description: "File extensions (default: .ts,.tsx,.js,.jsx,.mjs,.mts)" },
      },
      required: ["path"],
    },
  },
  {
    name: "coverage_map",
    description: "Map test coverage data to files. Returns per-file statement/branch/function/line percentages from vitest coverage JSON. Use after running `npm run test:coverage` to fill RTM Coverage columns.",
    inputSchema: {
      type: "object",
      properties: {
        path:         { type: "string", description: "Filter to files under this path (e.g., src/evals/)" },
        coverage_dir: { type: "string", description: "Coverage output directory (default: coverage/)" },
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

      if (name === "dependency_graph") {
        const result = toolDependencyGraph(args || {});
        if (result.error) {
          return { content: [{ type: "text", text: result.error }], isError: true };
        }
        const tag = result.cached ? " [cached]" : "";
        return { content: [{ type: "text", text: `${result.text}\n\n(${result.summary}${tag})` }] };
      }

      if (name === "coverage_map") {
        const result = toolCoverageMap(args || {});
        if (result.error) {
          return { content: [{ type: "text", text: result.error }], isError: true };
        }
        return { content: [{ type: "text", text: `${result.text}\n\n(${result.summary})` }] };
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
