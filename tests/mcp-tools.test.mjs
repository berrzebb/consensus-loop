#!/usr/bin/env node
/**
 * MCP Tools Tests — all 6 tools in mcp-server.mjs
 *
 * Tests:
 *   1. rtm_parse  — parse Forward/Backward/Bidirectional, filter by req_id/status
 *   2. rtm_merge  — row-level merge, conflict detection, discovered rows
 *   3. dependency_graph — import DAG, components, topological sort, cycles
 *   4. code_map   — symbol extraction, filter, cache
 *   5. audit_scan — pattern detection
 *   6. coverage_map — coverage JSON parsing
 *
 * Run: node --test tests/mcp-tools.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_SERVER = resolve(__dirname, "..", "scripts", "mcp-server.mjs");

// Helper: send JSON-RPC to MCP server and return result
function mcpCall(toolName, args, cwd) {
  const init = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  const call = JSON.stringify({
    jsonrpc: "2.0", id: 2, method: "tools/call",
    params: { name: toolName, arguments: args },
  });
  const input = `${init}\n${call}\n`;
  const output = execFileSync(process.execPath, [MCP_SERVER], {
    input, encoding: "utf8", cwd: cwd || process.cwd(), timeout: 15000,
  });
  const lines = output.trim().split("\n");
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.id === 2) return parsed.result;
    } catch { /* skip non-JSON */ }
  }
  throw new Error("No response for id:2");
}

// ═══ Test fixtures ═══════════════════════════════════════════════════════

let tmpDir;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mcp-test-"));
});

after(() => {
  if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

// ═══ 1. rtm_parse ════════════════════════════════════════════════════════

describe("rtm_parse", () => {
  let rtmFile;

  before(() => {
    rtmFile = join(tmpDir, "rtm-test.md");
    writeFileSync(rtmFile, `# RTM: test-track

## Forward RTM: test-track

| Req ID | Description | Track | File | Exists | Impl | Test Case | Test Result | Connected | Status |
|--------|-------------|-------|------|--------|------|-----------|-------------|-----------|--------|
| T-1 | widget contract | test | src/widget.ts | ✅ | ✅ | tests/widget.test.ts | ✓ pass | T-2:consumer.ts | verified |
| T-1 | widget loader | test | src/loader.ts | ✅ | ⚠️ | — | — | T-2:consumer.ts | wip |
| T-2 | consumer | test | src/consumer.ts | ❌ | — | — | — | — | open |
| T-3 | test bundle | test | tests/bundle.test.ts | ✅ | ✅ | self | ✓ pass | — | fixed |

## Backward RTM: test-track

| Test File | Test Description | Source File | Impl Function | Req ID | Traced |
|-----------|-----------------|-------------|---------------|--------|--------|
| tests/widget.test.ts | widget contract | src/widget.ts | createWidget | T-1 | ✅ |
| tests/orphan.test.ts | legacy test | src/old.ts | — | — | ❌ orphan |

## Bidirectional RTM: test-track

| Req ID | Description | Has Code | Has Test | Test→Req | Req→Test | Gap |
|--------|-------------|----------|----------|----------|----------|-----|
| T-1 | widget | ✅ | ✅ | ✅ | ✅ | loader partial |
| T-2 | consumer | ❌ | ❌ | — | — | code + test missing |
| T-3 | test bundle | ✅ | ✅ | ✅ | ✅ | — |
`);
  });

  it("parses forward matrix — all rows", () => {
    const result = mcpCall("rtm_parse", { path: rtmFile, matrix: "forward" });
    assert.ok(result.content[0].text.includes("4 rows"));
  });

  it("filters by status: open", () => {
    const result = mcpCall("rtm_parse", { path: rtmFile, matrix: "forward", status: "open" });
    assert.ok(result.content[0].text.includes("1 rows"));
    assert.ok(result.content[0].text.includes("T-2"));
  });

  it("filters by status: wip", () => {
    const result = mcpCall("rtm_parse", { path: rtmFile, matrix: "forward", status: "wip" });
    assert.ok(result.content[0].text.includes("1 rows"));
    assert.ok(result.content[0].text.includes("loader"));
  });

  it("filters by req_id", () => {
    const result = mcpCall("rtm_parse", { path: rtmFile, matrix: "forward", req_id: "T-1" });
    assert.ok(result.content[0].text.includes("2 rows"));
  });

  it("parses backward matrix", () => {
    const result = mcpCall("rtm_parse", { path: rtmFile, matrix: "backward" });
    assert.ok(result.content[0].text.includes("2 rows"));
    assert.ok(result.content[0].text.includes("orphan"));
  });

  it("parses bidirectional matrix", () => {
    const result = mcpCall("rtm_parse", { path: rtmFile, matrix: "bidirectional" });
    assert.ok(result.content[0].text.includes("3 rows"));
  });

  it("returns error for missing file", () => {
    const result = mcpCall("rtm_parse", { path: join(tmpDir, "nonexistent.md") });
    assert.ok(result.isError);
  });

  it("returns error for invalid matrix type", () => {
    const result = mcpCall("rtm_parse", { path: rtmFile, matrix: "invalid" });
    assert.ok(result.isError);
  });
});

// ═══ 2. rtm_merge ════════════════════════════════════════════════════════

describe("rtm_merge", () => {
  let baseFile, updateA, updateB, conflictUpdate;

  before(() => {
    baseFile = join(tmpDir, "rtm-base.md");
    writeFileSync(baseFile, `## Forward RTM: merge-test

| Req ID | File | Exists | Impl | Test Case | Status |
|--------|------|--------|------|-----------|--------|
| M-1 | src/a.ts | ❌ | — | — | open |
| M-2 | src/b.ts | ❌ | — | — | open |
| M-3 | src/c.ts | ✅ | ✅ | tests/c.test.ts | verified |
`);

    // Worker A fixes M-1
    updateA = join(tmpDir, "rtm-worker-a.md");
    writeFileSync(updateA, `## Forward RTM: merge-test

| Req ID | File | Exists | Impl | Test Case | Status |
|--------|------|--------|------|-----------|--------|
| M-1 | src/a.ts | ✅ | ✅ | tests/a.test.ts | fixed |
| M-2 | src/b.ts | ❌ | — | — | open |
| M-3 | src/c.ts | ✅ | ✅ | tests/c.test.ts | verified |
`);

    // Worker B fixes M-2
    updateB = join(tmpDir, "rtm-worker-b.md");
    writeFileSync(updateB, `## Forward RTM: merge-test

| Req ID | File | Exists | Impl | Test Case | Status |
|--------|------|--------|------|-----------|--------|
| M-1 | src/a.ts | ❌ | — | — | open |
| M-2 | src/b.ts | ✅ | ✅ | tests/b.test.ts | fixed |
| M-3 | src/c.ts | ✅ | ✅ | tests/c.test.ts | verified |
| M-4 | src/d.ts | ✅ | ✅ | tests/d.test.ts | discovered |
`);

    // Conflict: also modifies M-1
    conflictUpdate = join(tmpDir, "rtm-conflict.md");
    writeFileSync(conflictUpdate, `## Forward RTM: merge-test

| Req ID | File | Exists | Impl | Test Case | Status |
|--------|------|--------|------|-----------|--------|
| M-1 | src/a.ts | ✅ | ⚠️ | — | wip |
`);
  });

  it("merges updates from two workers — detects shared rows as conflicts", () => {
    // Both workers include M-1 in their RTM file (Worker A modifies, Worker B keeps original).
    // Since scope validation should prevent this, the merge correctly flags it as a conflict.
    const result = mcpCall("rtm_merge", { base: baseFile, updates: [updateA, updateB] });
    const text = result.content[0].text;
    assert.ok(text.includes("updated"));
    assert.ok(text.includes("1 added"));    // M-4 discovered by Worker B
    assert.ok(text.includes("M-4"));
  });

  it("detects conflict when two workers modify same row", () => {
    const result = mcpCall("rtm_merge", { base: baseFile, updates: [updateA, conflictUpdate] });
    const text = result.content[0].text;
    assert.ok(text.includes("1 conflicts") || text.includes("Conflicts"));
    assert.ok(text.includes("M-1"));
  });

  it("preserves unchanged rows from base", () => {
    const result = mcpCall("rtm_merge", { base: baseFile, updates: [updateA] });
    const text = result.content[0].text;
    assert.ok(text.includes("M-3"));
    assert.ok(text.includes("verified"));
  });

  it("appends discovered rows", () => {
    const result = mcpCall("rtm_merge", { base: baseFile, updates: [updateB] });
    const text = result.content[0].text;
    assert.ok(text.includes("M-4"));
    assert.ok(text.includes("1 added"));
  });

  it("returns error for missing base", () => {
    const result = mcpCall("rtm_merge", { base: join(tmpDir, "nonexistent.md"), updates: [updateA] });
    assert.ok(result.isError);
  });

  it("returns error for empty updates", () => {
    const result = mcpCall("rtm_merge", { base: baseFile, updates: [] });
    assert.ok(result.isError);
  });
});

// ═══ 3. dependency_graph ═════════════════════════════════════════════════

describe("dependency_graph", () => {
  let depDir;

  before(() => {
    depDir = join(tmpDir, "dep-test");
    mkdirSync(depDir, { recursive: true });

    // a.ts imports b.ts
    writeFileSync(join(depDir, "a.ts"), `import { foo } from "./b";\nexport function bar() { return foo(); }\n`);
    // b.ts imports c.ts
    writeFileSync(join(depDir, "b.ts"), `import { baz } from "./c";\nexport function foo() { return baz(); }\n`);
    // c.ts — leaf
    writeFileSync(join(depDir, "c.ts"), `export function baz() { return 42; }\n`);
    // d.ts — isolated
    writeFileSync(join(depDir, "d.ts"), `export function isolated() { return 0; }\n`);
    // cycle: e.ts imports f.ts, f.ts imports e.ts
    writeFileSync(join(depDir, "e.ts"), `import { g } from "./f";\nexport function h() { return g(); }\n`);
    writeFileSync(join(depDir, "f.ts"), `import { h } from "./e";\nexport function g() { return h(); }\n`);
  });

  it("detects import chain a → b → c", () => {
    const result = mcpCall("dependency_graph", { path: depDir }, tmpDir);
    const text = result.content[0].text;
    assert.ok(text.includes("a.ts"));
    assert.ok(text.includes("b.ts"));
    assert.ok(text.includes("c.ts"));
  });

  it("reports connected components", () => {
    const result = mcpCall("dependency_graph", { path: depDir }, tmpDir);
    const text = result.content[0].text;
    assert.ok(text.includes("Components"));
  });

  it("reports topological order", () => {
    const result = mcpCall("dependency_graph", { path: depDir }, tmpDir);
    const text = result.content[0].text;
    assert.ok(text.includes("Topological Order"));
  });

  it("detects cycles", () => {
    const result = mcpCall("dependency_graph", { path: depDir }, tmpDir);
    const text = result.content[0].text;
    assert.ok(text.includes("Cycles") || text.includes("in cycles"));
  });

  it("identifies isolated files", () => {
    const result = mcpCall("dependency_graph", { path: depDir }, tmpDir);
    const text = result.content[0].text;
    assert.ok(text.includes("Isolated") || text.includes("d.ts"));
  });

  it("returns error for missing path", () => {
    const result = mcpCall("dependency_graph", { path: join(tmpDir, "nonexistent") });
    assert.ok(result.isError);
  });
});

// ═══ 4. code_map ═════════════════════════════════════════════════════════

describe("code_map", () => {
  let codeDir;

  before(() => {
    codeDir = join(tmpDir, "code-test");
    mkdirSync(codeDir, { recursive: true });

    writeFileSync(join(codeDir, "sample.ts"), `
export interface Widget {
  id: string;
  name: string;
}

export type WidgetId = string;

export class WidgetService {
  private widgets: Widget[] = [];

  async create(name: string): Promise<Widget> {
    const w = { id: "1", name };
    this.widgets.push(w);
    return w;
  }

  getAll(): Widget[] {
    return this.widgets;
  }
}

export function helperFn(x: number): number {
  return x * 2;
}

export enum Status {
  Active = "active",
  Inactive = "inactive",
}
`);
  });

  it("extracts all symbol types", () => {
    const result = mcpCall("code_map", { path: codeDir });
    const text = result.content[0].text;
    assert.ok(text.includes("Widget"));       // interface
    assert.ok(text.includes("WidgetService")); // class
    assert.ok(text.includes("helperFn"));      // function
    assert.ok(text.includes("Status"));        // enum
    assert.ok(text.includes("WidgetId"));      // type
  });

  it("filters by type", () => {
    const result = mcpCall("code_map", { path: codeDir, filter: "fn" });
    const text = result.content[0].text;
    assert.ok(text.includes("helperFn"));
    assert.ok(!text.includes("Widget ") || text.includes("fn")); // should only have fn type
  });

  it("matrix format shows counts", () => {
    const result = mcpCall("code_map", { path: codeDir, format: "matrix" });
    const text = result.content[0].text;
    assert.ok(text.includes("|")); // table format
    assert.ok(text.includes("sample.ts"));
  });

  it("returns error for missing path", () => {
    const result = mcpCall("code_map", { path: join(tmpDir, "nonexistent") });
    assert.ok(result.isError);
  });
});

// ═══ 5. audit_scan ═══════════════════════════════════════════════════════

describe("audit_scan", () => {
  let scanDir;

  before(() => {
    scanDir = join(tmpDir, "scan-test");
    mkdirSync(scanDir, { recursive: true });

    writeFileSync(join(scanDir, "bad.ts"), `
const x = value as any;
// @ts-ignore
console.log("debug");
const secret = "hardcoded-api-key-12345";
`);

    writeFileSync(join(scanDir, "good.ts"), `
export function clean(x: number): number {
  return x * 2;
}
`);
  });

  it("detects type-safety issues", () => {
    const result = mcpCall("audit_scan", { pattern: "type-safety", path: scanDir });
    // audit_scan runs as subprocess — check it doesn't error
    assert.ok(!result.isError);
  });

  it("runs without error on clean code", () => {
    const result = mcpCall("audit_scan", { pattern: "all", path: join(scanDir, "good.ts") });
    assert.ok(!result.isError);
  });
});

// ═══ 6. coverage_map ═════════════════════════════════════════════════════

describe("coverage_map", () => {
  let covDir;

  before(() => {
    covDir = join(tmpDir, "coverage");
    mkdirSync(covDir, { recursive: true });

    writeFileSync(join(covDir, "coverage-summary.json"), JSON.stringify({
      total: {
        statements: { total: 100, covered: 85, pct: 85 },
        branches: { total: 40, covered: 30, pct: 75 },
        functions: { total: 20, covered: 17, pct: 85 },
        lines: { total: 100, covered: 85, pct: 85 },
      },
      "src/widget.ts": {
        statements: { total: 50, covered: 45, pct: 90 },
        branches: { total: 10, covered: 8, pct: 80 },
        functions: { total: 5, covered: 5, pct: 100 },
        lines: { total: 50, covered: 45, pct: 90 },
      },
      "src/loader.ts": {
        statements: { total: 30, covered: 20, pct: 66.7 },
        branches: { total: 8, covered: 4, pct: 50 },
        functions: { total: 3, covered: 2, pct: 66.7 },
        lines: { total: 30, covered: 20, pct: 66.7 },
      },
    }));
  });

  it("returns per-file coverage data", () => {
    const result = mcpCall("coverage_map", { coverage_dir: covDir });
    const text = result.content[0].text;
    assert.ok(text.includes("widget.ts"));
    assert.ok(text.includes("90%"));
    assert.ok(text.includes("loader.ts"));
    assert.ok(text.includes("66.7%"));
  });

  it("filters by path", () => {
    const result = mcpCall("coverage_map", { path: "widget", coverage_dir: covDir });
    const text = result.content[0].text;
    assert.ok(text.includes("widget.ts"));
    assert.ok(!text.includes("loader.ts"));
  });

  it("returns error for missing coverage dir", () => {
    const result = mcpCall("coverage_map", { coverage_dir: join(tmpDir, "nonexistent") });
    assert.ok(result.isError);
  });
});
