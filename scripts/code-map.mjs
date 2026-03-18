#!/usr/bin/env node
/**
 * code-map.mjs — Zero-token codebase scout for implementer agents.
 *
 * Outputs a compact symbol index: `path:L{n} type name`
 * so agents can Read(offset, limit) the exact range they need.
 *
 * Usage:
 *   node code-map.mjs <path>                       # directory or file
 *   node code-map.mjs <path> --filter fn            # functions only
 *   node code-map.mjs <path> --filter fn,class       # functions + classes
 *   node code-map.mjs <path> --depth 2              # max directory depth
 *   node code-map.mjs <path> --ext .ts,.mjs          # file extensions
 *   node code-map.mjs <path> --ranges               # include end lines (L10-L25)
 *
 * Output format:
 *   src/bus/redis.ts:L45 fn createClient(opts)
 *   src/bus/redis.ts:L78-L92 fn disconnect()         (with --ranges)
 *   src/agent/index.ts:L12 class AgentRunner
 *   src/agent/index.ts:L5 import { Router } from "express"
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, extname } from "node:path";

const DEFAULTS = {
  extensions: new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts"]),
  maxDepth: 10,
  filters: null, // null = all types
  showRanges: false,
};

// ── Symbol patterns ─────────────────────────────────────────
const PATTERNS = [
  // Functions
  { type: "fn", re: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/m },
  { type: "fn", re: /^(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*(?:=>|:\s*\w)/m },
  { type: "fn", re: /^(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?function/m },
  // Methods (class/object)
  { type: "method", re: /^\s+(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*[:{]/m },
  { type: "method", re: /^\s+(?:get|set)\s+(\w+)\s*\(/m },
  // Classes
  { type: "class", re: /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/m },
  // Interfaces / Types
  { type: "iface", re: /^(?:export\s+)?interface\s+(\w+)/m },
  { type: "type", re: /^(?:export\s+)?type\s+(\w+)\s*[=<]/m },
  // Enums
  { type: "enum", re: /^(?:export\s+)?enum\s+(\w+)/m },
  // Exports
  { type: "export", re: /^export\s+(?:default\s+)?(class|function|const|let|var)\s+(\w+)/m },
  // Imports (compact)
  { type: "import", re: /^import\s+(?:type\s+)?(?:\{([^}]+)\}|(\w+))\s+from\s+["']([^"']+)["']/m },
];

// ── Scope tracking for --ranges ─────────────────────────────
function findEndLine(lines, startIdx) {
  let depth = 0;
  let started = false;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === "{") { depth++; started = true; }
      if (ch === "}") { depth--; }
    }
    if (started && depth <= 0) return i + 1; // 1-indexed
  }
  return startIdx + 1;
}

// ── Parse a single file ─────────────────────────────────────
function parseFile(filePath, filters, showRanges) {
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
        const imported = (m[1] || m[2] || "").trim();
        const from = m[3];
        name = imported.length > 40 ? imported.slice(0, 37) + "..." : imported;
        detail = ` from "${from}"`;
      } else if (type === "export" && m[2]) {
        name = m[2];
        // Skip if already captured as fn/class
        continue;
      } else {
        name = m[1] || "";
        const params = m[2];
        if (params !== undefined) {
          detail = `(${params.length > 50 ? params.slice(0, 47) + "..." : params})`;
        }
      }

      const lineNum = i + 1;
      let loc = `L${lineNum}`;
      if (showRanges && ["fn", "method", "class", "iface", "enum"].includes(type)) {
        const endLine = findEndLine(lines, i);
        if (endLine > lineNum) loc = `L${lineNum}-L${endLine}`;
      }

      symbols.push({ line: lineNum, loc, type, name, detail });
      break; // one match per line
    }
  }
  return symbols;
}

// ── Walk directory ──────────────────────────────────────────
function walkDir(dir, extensions, maxDepth, depth = 0) {
  if (depth > maxDepth) return [];
  const files = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return []; }

  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") continue;
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDir(full, extensions, maxDepth, depth + 1));
    } else if (extensions.has(extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

// ── Main ────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help")) {
    console.log("Usage: node code-map.mjs <path> [--filter fn,class] [--depth N] [--ext .ts,.mjs] [--ranges]");
    console.log("\nTypes: fn, method, class, iface, type, enum, import, export");
    process.exit(0);
  }

  const target = resolve(args[0]);
  const opts = { ...DEFAULTS };

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--filter" && args[i + 1]) {
      opts.filters = new Set(args[++i].split(","));
    } else if (args[i] === "--depth" && args[i + 1]) {
      opts.maxDepth = parseInt(args[++i], 10);
    } else if (args[i] === "--ext" && args[i + 1]) {
      opts.extensions = new Set(args[++i].split(","));
    } else if (args[i] === "--ranges") {
      opts.showRanges = true;
    }
  }

  const stat = statSync(target, { throwIfNoEntry: false });
  if (!stat) { console.error(`Not found: ${target}`); process.exit(1); }

  const files = stat.isDirectory()
    ? walkDir(target, opts.extensions, opts.maxDepth)
    : [target];

  const cwd = process.cwd();
  let totalSymbols = 0;

  for (const file of files.sort()) {
    const symbols = parseFile(file, opts.filters, opts.showRanges);
    if (symbols.length === 0) continue;

    const rel = relative(cwd, file);
    for (const s of symbols) {
      console.log(`${rel}:${s.loc} ${s.type} ${s.name}${s.detail}`);
    }
    totalSymbols += symbols.length;
  }

  console.error(`\n${files.length} files, ${totalSymbols} symbols`);
}

main();
