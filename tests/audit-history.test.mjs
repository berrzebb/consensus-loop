#!/usr/bin/env node
/**
 * Audit History Tests — JSONL append + MCP tool query
 *
 * Run: node --test tests/audit-history.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_SERVER = resolve(__dirname, "..", "scripts", "mcp-server.mjs");

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
  for (const line of output.trim().split("\n")) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.id === 2) return parsed.result;
    } catch { /* skip */ }
  }
  throw new Error("No response for id:2");
}

let tmpDir;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "audit-hist-"));
});

after(() => {
  if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

describe("audit_history MCP tool", () => {
  let historyFile;

  before(() => {
    historyFile = join(tmpDir, "audit-history.jsonl");
    const entries = [
      { timestamp: "2026-03-19T10:00:00Z", session_id: "s1", track: "security-hardening", req_ids: ["SH-1", "SH-2"], verdict: "pending", rejection_codes: [{ code: "test-gap", severity: "major" }], agreed_count: 0, pending_count: 2, duration_ms: 30000 },
      { timestamp: "2026-03-19T10:30:00Z", session_id: "s1", track: "security-hardening", req_ids: ["SH-1", "SH-2"], verdict: "agree", rejection_codes: [], agreed_count: 2, pending_count: 0, duration_ms: 25000 },
      { timestamp: "2026-03-19T11:00:00Z", session_id: "s2", track: "tenant-runtime-isolation", req_ids: ["TN-1"], verdict: "pending", rejection_codes: [{ code: "lint-gap", severity: "major" }], agreed_count: 0, pending_count: 1, duration_ms: 20000 },
      { timestamp: "2026-03-19T11:30:00Z", session_id: "s2", track: "tenant-runtime-isolation", req_ids: ["TN-1"], verdict: "pending", rejection_codes: [{ code: "test-gap", severity: "major" }], agreed_count: 0, pending_count: 1, duration_ms: 22000 },
      { timestamp: "2026-03-19T12:00:00Z", session_id: "s2", track: "tenant-runtime-isolation", req_ids: ["TN-1"], verdict: "agree", rejection_codes: [], agreed_count: 1, pending_count: 0, duration_ms: 18000 },
      { timestamp: "2026-03-19T13:00:00Z", session_id: "s3", track: "observability-layer", req_ids: ["OB-1", "OB-2"], verdict: "agree", rejection_codes: [], agreed_count: 2, pending_count: 0, duration_ms: 35000 },
    ];
    writeFileSync(historyFile, entries.map(e => JSON.stringify(e)).join("\n") + "\n");
  });

  it("returns all entries in detail mode", () => {
    const result = mcpCall("audit_history", { path: historyFile });
    const text = result.content[0].text;
    assert.ok(text.includes("6 entries"));
    assert.ok(text.includes("security-hardening"));
    assert.ok(text.includes("tenant-runtime-isolation"));
    assert.ok(text.includes("observability-layer"));
  });

  it("filters by track", () => {
    const result = mcpCall("audit_history", { path: historyFile, track: "security" });
    const text = result.content[0].text;
    assert.ok(text.includes("2 entries"));
    assert.ok(text.includes("security-hardening"));
    assert.ok(!text.includes("tenant-runtime-isolation"));
  });

  it("filters by rejection code", () => {
    const result = mcpCall("audit_history", { path: historyFile, code: "test-gap" });
    const text = result.content[0].text;
    assert.ok(text.includes("2 entries"));
  });

  it("filters by since timestamp", () => {
    const result = mcpCall("audit_history", { path: historyFile, since: "2026-03-19T12:00:00Z" });
    const text = result.content[0].text;
    assert.ok(text.includes("2 entries"));
  });

  it("returns summary statistics", () => {
    const result = mcpCall("audit_history", { path: historyFile, summary: true });
    const text = result.content[0].text;
    assert.ok(text.includes("Summary"));
    assert.ok(text.includes("Agree: 3"));
    assert.ok(text.includes("Pending: 3"));
    assert.ok(text.includes("50%")); // approval rate
  });

  it("shows rejection code frequency in summary", () => {
    const result = mcpCall("audit_history", { path: historyFile, summary: true });
    const text = result.content[0].text;
    assert.ok(text.includes("test-gap"));
    assert.ok(text.includes("lint-gap"));
  });

  it("shows track distribution in summary", () => {
    const result = mcpCall("audit_history", { path: historyFile, summary: true });
    const text = result.content[0].text;
    assert.ok(text.includes("security-hardening"));
    assert.ok(text.includes("tenant-runtime-isolation"));
  });

  it("returns error for missing file", () => {
    const result = mcpCall("audit_history", { path: join(tmpDir, "nonexistent.jsonl") });
    assert.ok(result.isError);
  });

  it("handles empty history gracefully", () => {
    const emptyFile = join(tmpDir, "empty.jsonl");
    writeFileSync(emptyFile, "");
    const result = mcpCall("audit_history", { path: emptyFile });
    const text = result.content[0].text;
    assert.ok(text.includes("0 entries") || text.includes("No matching"));
  });
});
