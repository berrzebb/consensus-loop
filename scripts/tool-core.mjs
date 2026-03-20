/**
 * tool-core.mjs — Pure tool functions shared by MCP server and CLI runner.
 *
 * Extracted from mcp-server.mjs to enable both:
 *   - mcp-server.mjs (JSON-RPC over stdio)
 *   - tool-runner.mjs (CLI entry point for skills)
 *
 * All functions are side-effect-free: params → { text, summary, json? } | { error }.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, relative, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { runFvmValidation } from "./fvm-validator.mjs";
import { generateFvm } from "./fvm-generator.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ═══ Cache ══════════════════════════════════════════════════════════════

const CACHE = new Map();

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

    if (rel !== prevFile) {
      if (prevFile) rows.push("");
      rows.push(`## ${rel} (${symbols.length})`);
      prevFile = rel;
    }

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
    let lineCount = 0;
    try { lineCount = readFileSync(file, "utf8").split("\n").length; } catch { /* skip */ }

    const counts = { fn: 0, method: 0, class: 0, iface: 0, type: 0, enum: 0 };
    for (const s of symbols) {
      if (s.type in counts) counts[s.type]++;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (total === 0) continue;

    const cell = (n) => n > 0 ? String(n) : "·";
    rows.push(
      `| ${rel} | ${lineCount} | ${cell(counts.fn)} | ${cell(counts.method)} | ${cell(counts.class)} | ${cell(counts.iface)} | ${cell(counts.type)} | ${cell(counts.enum)} |`
    );
  }

  return rows.join("\n");
}

// ═══ Tool: code_map ═════════════════════════════════════════════════════

export function toolCodeMap(params) {
  const { path: targetPath, filter, depth = 5 } = params;
  if (!targetPath) return { error: "path is required" };

  const target = resolve(targetPath);
  const stat = statSync(target, { throwIfNoEntry: false });
  if (!stat) return { error: `Not found: ${target}` };

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

  CACHE.set(cacheKey, { mtime: latestMtime, result });

  return result;
}

// ═══ Tool: audit_scan ═══════════════════════════════════════════════════

export function toolAuditScan(params) {
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

export function toolCoverageMap(params) {
  const { path: targetPath, coverage_dir: covDir = "coverage" } = params;
  const cwd = process.cwd();
  const coverageMap = loadCoverageSummary(resolve(cwd, covDir));
  if (!coverageMap) return { error: `No coverage data at ${resolve(cwd, covDir, "coverage-summary.json")}. Run: npm run test:coverage` };

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
  return null;
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

  const edges = new Map();
  const inEdges = new Map();

  for (const file of files) {
    const norm = file.replace(/\\/g, "/");
    if (!edges.has(norm)) edges.set(norm, new Set());
    if (!inEdges.has(norm)) inEdges.set(norm, new Set());

    const imports = extractImports(file);
    for (const spec of imports) {
      const resolved = resolveImportPath(file, spec, extArr);
      if (!resolved) continue;
      const resolvedNorm = resolved.replace(/\\/g, "/");
      if (!fileSet.has(resolvedNorm)) continue;

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

  rows.push("## Components\n");
  rows.push(`${components.length} connected components, ${files.length} files, ${totalEdges} edges\n`);
  for (let i = 0; i < components.length; i++) {
    const comp = components[i];
    if (comp.length === 1) continue;
    rows.push(`### Component ${i} (${comp.length} files)`);
    for (const f of comp.sort()) {
      rows.push(`  ${relative(cwd, f).replace(/\\/g, "/")}`);
    }
    rows.push("");
  }

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

  if (topoOrder.length > 0) {
    rows.push("## Topological Order (safe execution sequence)\n");
    for (let i = 0; i < topoOrder.length; i++) {
      rows.push(`${i + 1}. ${relative(cwd, topoOrder[i]).replace(/\\/g, "/")}`);
    }
    rows.push("");
  }

  if (cycleFiles.length > 0) {
    rows.push("## Cycles Detected\n");
    rows.push("These files have circular dependencies and cannot be topologically sorted:\n");
    for (const f of cycleFiles.sort()) {
      rows.push(`- ${relative(cwd, f).replace(/\\/g, "/")}`);
    }
  }

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

export function toolDependencyGraph(params) {
  const { path: targetPath, depth = 5, extensions } = params;
  if (!targetPath) return { error: "path is required" };

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

// ═══ Tool: rtm_merge ════════════════════════════════════════════════════

function parseRtmTable(content) {
  const rows = new Map();
  const lines = content.split(/\r?\n/);
  let inTable = false;
  let headerCols = [];

  for (const line of lines) {
    if (!line.startsWith("|")) { inTable = false; continue; }

    const cells = line.split("|").map(c => c.trim()).filter((_, i, a) => i > 0 && i < a.length);

    if (!inTable && cells.some(c => /Req\s*ID/i.test(c))) {
      headerCols = cells;
      inTable = true;
      continue;
    }
    if (inTable && cells.every(c => c === "" || /^[-:]+$/.test(c))) continue;

    if (!inTable) continue;

    const reqIdx = headerCols.findIndex(c => /Req\s*ID/i.test(c));
    const fileIdx = headerCols.findIndex(c => /^File$/i.test(c));
    if (reqIdx < 0 || fileIdx < 0 || reqIdx >= cells.length || fileIdx >= cells.length) continue;

    const key = `${cells[reqIdx]}|${cells[fileIdx]}`;
    rows.set(key, { cells, raw: line });
  }
  return rows;
}

export function toolRtmMerge(params) {
  const { base, updates } = params;
  if (!base) return { error: "base path is required" };
  if (!updates || !Array.isArray(updates) || updates.length === 0) {
    return { error: "updates array is required (paths to worktree RTM files)" };
  }

  const basePath = resolve(base);
  if (!existsSync(basePath)) return { error: `Base RTM not found: ${base}` };
  const baseContent = readFileSync(basePath, "utf8");
  const baseRows = parseRtmTable(baseContent);

  const merged = new Map(baseRows);
  const conflicts = [];
  const additions = [];
  const updates_applied = [];
  const sourceMap = new Map();

  for (const updatePath of updates) {
    const fullPath = resolve(updatePath);
    if (!existsSync(fullPath)) {
      conflicts.push({ path: updatePath, error: "file not found" });
      continue;
    }
    const updateContent = readFileSync(fullPath, "utf8");
    const updateRows = parseRtmTable(updateContent);

    for (const [key, row] of updateRows) {
      if (!merged.has(key)) {
        merged.set(key, row);
        sourceMap.set(key, updatePath);
        additions.push({ key, source: updatePath });
      } else {
        const existing = merged.get(key);
        if (sourceMap.has(key) && sourceMap.get(key) !== updatePath) {
          conflicts.push({
            key,
            sources: [sourceMap.get(key), updatePath],
            base: existing.raw,
            update: row.raw,
          });
        } else if (existing.raw !== row.raw) {
          merged.set(key, row);
          sourceMap.set(key, updatePath);
          updates_applied.push({ key, source: updatePath });
        }
      }
    }
  }

  const output = [];
  output.push("## RTM Merge Result\n");
  output.push(`- Base: ${base}`);
  output.push(`- Updates: ${updates.length} files`);
  output.push(`- Rows: ${merged.size} total, ${updates_applied.length} updated, ${additions.length} added, ${conflicts.length} conflicts\n`);

  if (conflicts.length > 0) {
    output.push("### Conflicts (require manual resolution)\n");
    for (const c of conflicts) {
      if (c.error) {
        output.push(`- **${c.path}**: ${c.error}`);
      } else {
        output.push(`- **${c.key}**: modified by \`${c.sources[0]}\` and \`${c.sources[1]}\``);
        output.push(`  - Source 1: ${c.base}`);
        output.push(`  - Source 2: ${c.update}`);
      }
    }
    output.push("");
  }

  if (updates_applied.length > 0) {
    output.push("### Updated Rows\n");
    output.push("| Req ID | File | Source |");
    output.push("|--------|------|--------|");
    for (const u of updates_applied) {
      const [reqId, file] = u.key.split("|");
      const rel = relative(process.cwd(), u.source).replace(/\\/g, "/");
      output.push(`| ${reqId} | ${file} | ${rel} |`);
    }
    output.push("");
  }

  if (additions.length > 0) {
    output.push("### New Rows (discovered)\n");
    output.push("| Req ID | File | Source |");
    output.push("|--------|------|--------|");
    for (const a of additions) {
      const [reqId, file] = a.key.split("|");
      const rel = relative(process.cwd(), a.source).replace(/\\/g, "/");
      output.push(`| ${reqId} | ${file} | ${rel} |`);
    }
    output.push("");
  }

  output.push("### Merged Forward RTM\n");
  const allRows = [...merged.values()];
  if (allRows.length > 0) {
    const headers = ["Req ID", "Description", "Track", "Design Ref", "File", "Exists", "Impl", "Test Case", "Test Result", "Connected", "Status"];
    output.push("| " + allRows[0].cells.map((_, i) => headers[i] || `Col${i}`).join(" | ") + " |");
    output.push("|" + allRows[0].cells.map(() => "---").join("|") + "|");
    for (const row of allRows) {
      output.push(row.raw);
    }
  }

  return {
    text: output.join("\n"),
    summary: `${merged.size} rows, ${updates_applied.length} updated, ${additions.length} added, ${conflicts.length} conflicts`,
    json: {
      total: merged.size,
      updated: updates_applied.length,
      added: additions.length,
      conflicts: conflicts.length,
    },
  };
}

// ═══ Tool: rtm_parse ════════════════════════════════════════════════════

export function toolRtmParse(params) {
  const { path: targetPath, matrix = "forward", req_id, status: statusFilter } = params;
  if (!targetPath) return { error: "path is required" };

  const fullPath = resolve(targetPath);
  if (!existsSync(fullPath)) return { error: `Not found: ${targetPath}` };

  const content = readFileSync(fullPath, "utf8");
  const lines = content.split(/\r?\n/);

  const matrixPatterns = {
    forward:       /^##\s+(?:순방향|Forward)\s+RTM/i,
    backward:      /^##\s+(?:역방향|Backward)\s+RTM/i,
    bidirectional: /^##\s+(?:양방향|Bidirectional)\s+RTM/i,
  };
  const sectionRe = matrixPatterns[matrix];
  if (!sectionRe) return { error: `Unknown matrix type: ${matrix}. Use: forward, backward, bidirectional` };

  let sectionStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (sectionRe.test(lines[i].trim())) { sectionStart = i; break; }
  }
  const searchStart = sectionStart >= 0 ? sectionStart : 0;

  let headerLine = -1;
  let headerCols = [];
  const rows = [];

  for (let i = searchStart; i < lines.length; i++) {
    const line = lines[i];

    if (i > searchStart && /^##\s+/.test(line) && sectionStart >= 0) break;

    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map(c => c.trim()).filter((_, idx, a) => idx > 0 && idx < a.length);

    if (headerLine < 0 && cells.some(c => /Req\s*ID|Test\s*File/i.test(c))) {
      headerCols = cells;
      headerLine = i;
      continue;
    }
    if (headerLine >= 0 && cells.every(c => c === "" || /^[-:]+$/.test(c))) continue;
    if (headerLine < 0) continue;

    const row = {};
    for (let j = 0; j < headerCols.length && j < cells.length; j++) {
      const key = headerCols[j]
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_]/g, "");
      row[key] = cells[j];
    }
    rows.push(row);
  }

  let filtered = rows;
  if (req_id) {
    filtered = filtered.filter(r => (r.req_id || "").includes(req_id));
  }
  if (statusFilter) {
    filtered = filtered.filter(r => (r.status || "").toLowerCase() === statusFilter.toLowerCase());
  }

  const output = [];
  output.push(`## ${matrix} RTM — ${filtered.length} rows${req_id ? ` (filtered: ${req_id})` : ""}${statusFilter ? ` (status: ${statusFilter})` : ""}\n`);

  if (filtered.length === 0) {
    output.push("No matching rows found.");
  } else {
    output.push("| " + headerCols.join(" | ") + " |");
    output.push("|" + headerCols.map(() => "---").join("|") + "|");
    for (const row of filtered) {
      const cells = headerCols.map(h => {
        const key = h.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
        return row[key] || "—";
      });
      output.push("| " + cells.join(" | ") + " |");
    }

    if (matrix === "forward") {
      const statuses = {};
      for (const r of filtered) {
        const s = (r.status || "unknown").toLowerCase();
        statuses[s] = (statuses[s] || 0) + 1;
      }
      output.push("");
      output.push("**Status summary**: " + Object.entries(statuses).map(([k, v]) => `${k}: ${v}`).join(", "));
    }
  }

  return {
    text: output.join("\n"),
    summary: `${filtered.length}/${rows.length} rows`,
    json: {
      matrix,
      total: rows.length,
      filtered: filtered.length,
      rows: filtered,
    },
  };
}

// ═══ Tool: audit_history ════════════════════════════════════════════════

export function toolAuditHistory(params) {
  const { path: historyPath, track, code, since, summary = false } = params;

  const defaultPath = resolve(process.cwd(), ".claude", "audit-history.jsonl");
  const fullPath = historyPath ? resolve(historyPath) : defaultPath;

  if (!existsSync(fullPath)) {
    return { text: `No audit history yet. The file ${fullPath} will be created automatically after the first audit verdict (respond.mjs appends to it).`, summary: "0 entries", json: { total: 0 } };
  }

  const content = readFileSync(fullPath, "utf8");
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  let entries = [];
  for (const line of lines) {
    try { entries.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }

  if (track) {
    entries = entries.filter(e => (e.track || "").toLowerCase().includes(track.toLowerCase()));
  }
  if (code) {
    entries = entries.filter(e =>
      (e.rejection_codes || []).some(rc =>
        (typeof rc === "string" ? rc : rc.code || "").includes(code)
      )
    );
  }
  if (since) {
    const sinceMs = new Date(since).getTime();
    if (!isNaN(sinceMs)) {
      entries = entries.filter(e => new Date(e.timestamp).getTime() >= sinceMs);
    }
  }

  if (entries.length === 0) {
    return { text: "No matching audit history entries.", summary: "0 entries", json: { total: 0 } };
  }

  const output = [];

  if (summary) {
    const byVerdict = { agree: 0, pending: 0 };
    const byTrack = {};
    const byCode = {};
    let totalRounds = 0;

    for (const e of entries) {
      byVerdict[e.verdict] = (byVerdict[e.verdict] || 0) + 1;
      if (e.track) byTrack[e.track] = (byTrack[e.track] || 0) + 1;
      for (const rc of (e.rejection_codes || [])) {
        const c = typeof rc === "string" ? rc : rc.code || "unknown";
        byCode[c] = (byCode[c] || 0) + 1;
      }
      totalRounds++;
    }

    output.push("## Audit History Summary\n");
    output.push(`- Total entries: ${totalRounds}`);
    output.push(`- Agree: ${byVerdict.agree || 0}, Pending: ${byVerdict.pending || 0}`);
    output.push(`- Approval rate: ${totalRounds > 0 ? Math.round(((byVerdict.agree || 0) / totalRounds) * 100) : 0}%\n`);

    if (Object.keys(byTrack).length > 0) {
      output.push("### By Track\n");
      output.push("| Track | Entries |");
      output.push("|-------|--------|");
      for (const [t, count] of Object.entries(byTrack).sort((a, b) => b[1] - a[1])) {
        output.push(`| ${t} | ${count} |`);
      }
      output.push("");
    }

    if (Object.keys(byCode).length > 0) {
      output.push("### By Rejection Code\n");
      output.push("| Code | Count |");
      output.push("|------|-------|");
      for (const [c, count] of Object.entries(byCode).sort((a, b) => b[1] - a[1])) {
        output.push(`| ${c} | ${count} |`);
      }
      output.push("");
    }

    const patterns = [];
    for (const [c, count] of Object.entries(byCode)) {
      if (count >= 3) patterns.push(`⚠️ \`${c}\` appeared ${count} times — structural issue likely`);
    }
    if (patterns.length > 0) {
      output.push("### Risk Patterns\n");
      for (const p of patterns) output.push(`- ${p}`);
    }

    return {
      text: output.join("\n"),
      summary: `${totalRounds} entries, ${byVerdict.agree || 0} agree, ${byVerdict.pending || 0} pending`,
      json: { total: totalRounds, byVerdict, byTrack, byCode },
    };
  }

  // Detail mode
  output.push("## Audit History\n");
  output.push("| Timestamp | Track | Verdict | Req IDs | Rejection Codes |");
  output.push("|-----------|-------|---------|---------|-----------------|");

  for (const e of entries.slice(-50)) {
    const codes = (e.rejection_codes || []).map(rc =>
      typeof rc === "string" ? rc : `${rc.code}[${rc.severity}]`
    ).join(", ") || "—";
    const reqIds = (e.req_ids || []).join(", ") || "—";
    const ts = e.timestamp ? e.timestamp.slice(0, 16).replace("T", " ") : "—";
    output.push(`| ${ts} | ${e.track || "—"} | ${e.verdict} | ${reqIds} | ${codes} |`);
  }

  return {
    text: output.join("\n"),
    summary: `${entries.length} entries (showing last ${Math.min(entries.length, 50)})`,
    json: { total: entries.length, entries: entries.slice(-50) },
  };
}

// ═══ Tool: act_analyze ═══════════════════════════════════════════════════

/**
 * Analyze audit history + FVM results → produce structured improvement items
 * for the PDCA Act phase. Output is work-catalog-ready.
 */

const IMPROVEMENT_THRESHOLDS = {
  fp_rate_warn: 0.3,          // flag rejection code if FP rate > 30%
  repeat_rejection_warn: 3,   // flag if same code appears 3+ times on a track
  correction_rounds_warn: 3,  // flag if avg correction rounds > 3
  fvm_auth_leak_block: 1,     // any AUTH_LEAK is critical
  fvm_false_deny_warn: 0.2,   // flag if FALSE_DENY rate > 20%
};

export function toolActAnalyze(params) {
  const {
    audit_history_path,
    fvm_results_path,
    track,
    thresholds: customThresholds,
  } = params;

  const T = { ...IMPROVEMENT_THRESHOLDS, ...customThresholds };
  const cwd = process.cwd();
  const items = [];
  let auditMetrics = null;
  let fvmMetrics = null;

  // ── Audit history analysis ──

  const histPath = audit_history_path
    ? resolve(audit_history_path)
    : resolve(cwd, ".claude", "audit-history.jsonl");

  if (existsSync(histPath)) {
    const content = readFileSync(histPath, "utf8");
    const lines = content.split(/\r?\n/).filter(l => l.trim());
    let entries = [];
    for (const line of lines) {
      try { entries.push(JSON.parse(line)); } catch { /* skip */ }
    }
    if (track) {
      entries = entries.filter(e => (e.track || "").toLowerCase().includes(track.toLowerCase()));
    }

    if (entries.length > 0) {
      // Compute metrics
      const byCode = {};
      const byTrack = {};
      const byVerdict = { agree: 0, pending: 0 };
      let totalRounds = 0;

      for (const e of entries) {
        byVerdict[e.verdict] = (byVerdict[e.verdict] || 0) + 1;
        if (e.track) byTrack[e.track] = (byTrack[e.track] || 0) + 1;
        for (const rc of (e.rejection_codes || [])) {
          const c = typeof rc === "string" ? rc : rc.code || "unknown";
          byCode[c] = (byCode[c] || 0) + 1;
        }
        totalRounds++;
      }

      const approvalRate = totalRounds > 0 ? (byVerdict.agree || 0) / totalRounds : 1;
      const avgCorrections = totalRounds > 0
        ? (byVerdict.pending || 0) / Math.max(byVerdict.agree || 1, 1)
        : 0;

      auditMetrics = {
        total: totalRounds,
        approval_rate: Math.round(approvalRate * 100),
        avg_corrections: Math.round(avgCorrections * 10) / 10,
        by_code: byCode,
        by_track: byTrack,
      };

      // Generate improvement items from audit patterns
      for (const [code, count] of Object.entries(byCode)) {
        if (count >= T.repeat_rejection_warn) {
          items.push({
            id: `ACT-A-${items.length + 1}`,
            type: "policy",
            source: "audit_history",
            metric: `${code}: ${count} rejections`,
            description: `Rejection code \`${code}\` appeared ${count} times — review policy in rejection-codes.md`,
            priority: count >= 5 ? "high" : "medium",
            target_file: `templates/references/\${locale}/rejection-codes.md`,
          });
        }
      }

      if (avgCorrections > T.correction_rounds_warn) {
        items.push({
          id: `ACT-A-${items.length + 1}`,
          type: "process",
          source: "audit_history",
          metric: `avg ${auditMetrics.avg_corrections} correction rounds`,
          description: `Average correction rounds (${auditMetrics.avg_corrections}) exceeds threshold (${T.correction_rounds_warn}) — review evidence format or done-criteria clarity`,
          priority: "high",
          target_file: `templates/references/\${locale}/evidence-format.md`,
        });
      }
    }
  }

  // ── FVM results analysis ──

  if (fvm_results_path && existsSync(resolve(fvm_results_path))) {
    const fvmContent = readFileSync(resolve(fvm_results_path), "utf8");

    // Parse summary line: "N rows, N passed, N failed"
    const summaryMatch = fvmContent.match(/Total:\s*(\d+)\s*rows?,\s*(\d+)\s*passed,\s*(\d+)\s*failed/i);
    if (summaryMatch) {
      const total = parseInt(summaryMatch[1]);
      const passed = parseInt(summaryMatch[2]);
      const failed = parseInt(summaryMatch[3]);

      // Count failure types from table
      const authLeaks = (fvmContent.match(/AUTH_LEAK/g) || []).length;
      const falseDenies = (fvmContent.match(/FALSE_DENY/g) || []).length;
      const paramErrors = (fvmContent.match(/PARAM_ERROR/g) || []).length;

      fvmMetrics = {
        total, passed, failed,
        pass_rate: total > 0 ? Math.round((passed / total) * 100) : 0,
        auth_leaks: authLeaks,
        false_denies: falseDenies,
        param_errors: paramErrors,
      };

      if (authLeaks >= T.fvm_auth_leak_block) {
        items.push({
          id: `ACT-F-${items.length + 1}`,
          type: "security",
          source: "fvm_validate",
          metric: `${authLeaks} AUTH_LEAK(s)`,
          description: `${authLeaks} endpoint(s) accessible by unauthorized roles — add auth guards`,
          priority: "critical",
          target_file: "src/dashboard/routes/",
        });
      }

      if (total > 0 && falseDenies / total > T.fvm_false_deny_warn) {
        items.push({
          id: `ACT-F-${items.length + 1}`,
          type: "tooling",
          source: "fvm_validate",
          metric: `${falseDenies} FALSE_DENY (${Math.round(falseDenies / total * 100)}%)`,
          description: `FVM FALSE_DENY rate ${Math.round(falseDenies / total * 100)}% — improve fvm_generate page-to-endpoint tier mapping`,
          priority: "medium",
          target_file: "scripts/fvm-generator.mjs",
        });
      }

      if (paramErrors > 0) {
        items.push({
          id: `ACT-F-${items.length + 1}`,
          type: "testing",
          source: "fvm_validate",
          metric: `${paramErrors} PARAM_ERROR(s)`,
          description: `${paramErrors} endpoint(s) return 400/422 — add request body fixtures to FVM validator`,
          priority: "low",
          target_file: "scripts/fvm-validator.mjs",
        });
      }
    }
  }

  // ── Format output ──

  const out = [];
  out.push("## Act Analysis — PDCA Improvement Items\n");
  out.push(`Generated: ${new Date().toISOString()}\n`);

  // Metrics summary
  if (auditMetrics) {
    out.push("### Audit Metrics\n");
    out.push(`- Total rounds: ${auditMetrics.total}`);
    out.push(`- Approval rate: ${auditMetrics.approval_rate}%`);
    out.push(`- Avg correction rounds: ${auditMetrics.avg_corrections}`);
    const topCodes = Object.entries(auditMetrics.by_code).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, n]) => `${c}(${n})`).join(", ");
    out.push(`- Top rejection codes: ${topCodes}`);
    out.push("");
  }

  if (fvmMetrics) {
    out.push("### FVM Metrics\n");
    out.push(`- Pass rate: ${fvmMetrics.pass_rate}% (${fvmMetrics.passed}/${fvmMetrics.total})`);
    out.push(`- AUTH_LEAK: ${fvmMetrics.auth_leaks}`);
    out.push(`- FALSE_DENY: ${fvmMetrics.false_denies}`);
    out.push(`- PARAM_ERROR: ${fvmMetrics.param_errors}`);
    out.push("");
  }

  // Improvement items in work-catalog format
  if (items.length > 0) {
    out.push("### Improvement Items (work-catalog format)\n");
    out.push("| ID | Type | Priority | Source | Description | Target |");
    out.push("|---|---|---|---|---|---|");
    for (const item of items) {
      out.push(`| ${item.id} | ${item.type} | ${item.priority} | ${item.source} | ${item.description} | ${item.target_file} |`);
    }
    out.push("");
    out.push("**Action**: Append approved items to `work-catalog.md` under a new `## Act Improvements` section.");
  } else {
    out.push("### No Improvement Items\n");
    out.push("All metrics within thresholds. No structural improvements needed this cycle.");
  }

  const summary = `${items.length} improvement items` +
    (auditMetrics ? `, audit: ${auditMetrics.approval_rate}% approval` : "") +
    (fvmMetrics ? `, fvm: ${fvmMetrics.pass_rate}% pass` : "");

  return {
    text: out.join("\n"),
    summary,
    json: {
      items,
      audit_metrics: auditMetrics,
      fvm_metrics: fvmMetrics,
      thresholds: T,
    },
  };
}

// ═══ Re-exports ═════════════════════════════════════════════════════════

export { generateFvm, runFvmValidation };

// ═══ Tool name registry ═════════════════════════════════════════════════

export const TOOL_NAMES = [
  "code_map", "audit_scan", "coverage_map",
  "dependency_graph", "rtm_parse", "rtm_merge",
  "audit_history", "fvm_generate", "fvm_validate",
  "act_analyze",
];
