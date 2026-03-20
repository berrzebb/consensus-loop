#!/usr/bin/env node
/**
 * Act Analyze Tests — PDCA Act phase tool.
 * Run: node --test tests/act-analyze.test.mjs
 */
import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_URL = pathToFileURL(resolve(__dirname, "..", "scripts", "tool-core.mjs")).href;
const { toolActAnalyze } = await import(CORE_URL);

describe("act_analyze — no data", () => {
  it("returns empty items when no audit history exists", () => {
    const result = toolActAnalyze({ audit_history_path: "/nonexistent/path.jsonl" });
    assert.ok(!result.error);
    assert.equal(result.json.items.length, 0);
    assert.ok(result.text.includes("No Improvement Items"));
  });
});

describe("act_analyze — audit history patterns", () => {
  let tmpDir, histPath;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "act-test-"));
    histPath = join(tmpDir, "audit-history.jsonl");

    // Create audit history with patterns
    const entries = [
      // CC-2 rejected 5 times (should trigger improvement item)
      ...Array(5).fill(null).map((_, i) => JSON.stringify({
        timestamp: `2026-03-19T10:0${i}:00Z`,
        track: "FVM",
        verdict: "pending",
        req_ids: ["FVM-1"],
        rejection_codes: [{ code: "CC-2", severity: "major" }],
      })),
      // T-1 rejected 2 times (below threshold)
      ...Array(2).fill(null).map((_, i) => JSON.stringify({
        timestamp: `2026-03-19T11:0${i}:00Z`,
        track: "FVM",
        verdict: "pending",
        req_ids: ["FVM-2"],
        rejection_codes: [{ code: "T-1", severity: "major" }],
      })),
      // 3 agrees
      ...Array(3).fill(null).map((_, i) => JSON.stringify({
        timestamp: `2026-03-19T12:0${i}:00Z`,
        track: "FVM",
        verdict: "agree",
        req_ids: [`FVM-${i + 1}`],
        rejection_codes: [],
      })),
    ];
    writeFileSync(histPath, entries.join("\n"));
  });

  after(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects repeated rejection codes", () => {
    const result = toolActAnalyze({ audit_history_path: histPath });
    assert.ok(!result.error);
    const ccItem = result.json.items.find(i => i.metric.includes("CC-2"));
    assert.ok(ccItem, "Should flag CC-2 with 5 rejections");
    assert.equal(ccItem.type, "policy");
    assert.ok(ccItem.priority === "high" || ccItem.priority === "medium");
  });

  it("does not flag codes below threshold", () => {
    const result = toolActAnalyze({ audit_history_path: histPath });
    const t1Item = result.json.items.find(i => i.metric.includes("T-1"));
    assert.ok(!t1Item, "T-1 with 2 rejections should not be flagged (threshold 3)");
  });

  it("computes audit metrics", () => {
    const result = toolActAnalyze({ audit_history_path: histPath });
    assert.ok(result.json.audit_metrics);
    assert.equal(result.json.audit_metrics.total, 10);
    assert.equal(result.json.audit_metrics.by_code["CC-2"], 5);
  });

  it("filters by track", () => {
    const result = toolActAnalyze({ audit_history_path: histPath, track: "FVM" });
    assert.equal(result.json.audit_metrics.total, 10);

    const noMatch = toolActAnalyze({ audit_history_path: histPath, track: "nonexistent" });
    assert.ok(!noMatch.json.audit_metrics); // no entries match
  });
});

describe("act_analyze — FVM results", () => {
  let tmpDir, fvmPath;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "act-fvm-"));
    fvmPath = join(tmpDir, "fvm-results.md");

    writeFileSync(fvmPath, `## FVM Validation Results

Base URL: http://localhost:8087
Total: 100 rows, 60 passed, 40 failed

### Failures

| Route | Feature | Endpoint | Method | Role | Expected | Actual | Verdict |
|-------|---------|----------|--------|------|----------|--------|---------|
| /admin | users | /api/admin/users | GET | viewer | 403 | 200 | AUTH_LEAK |
| /admin | users | /api/admin/users | POST | viewer | 403 | 200 | AUTH_LEAK |
| /chat | send | /api/chat | POST | user | 200 | 403 | FALSE_DENY |
| /chat | send | /api/chat | POST | member | 200 | 403 | FALSE_DENY |
| /settings | config | /api/config | PUT | member | 200 | 400 | PARAM_ERROR |
`);
  });

  after(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects AUTH_LEAK as critical", () => {
    const result = toolActAnalyze({ fvm_results_path: fvmPath });
    assert.ok(!result.error);
    const leak = result.json.items.find(i => i.type === "security");
    assert.ok(leak, "Should flag AUTH_LEAK");
    assert.equal(leak.priority, "critical");
  });

  it("detects high FALSE_DENY rate", () => {
    const result = toolActAnalyze({ fvm_results_path: fvmPath });
    // 40 failed out of 100, but FALSE_DENY specifically counted from table
    assert.ok(result.json.fvm_metrics);
    assert.equal(result.json.fvm_metrics.auth_leaks, 2);
    assert.equal(result.json.fvm_metrics.false_denies, 2);
  });

  it("computes FVM metrics", () => {
    const result = toolActAnalyze({ fvm_results_path: fvmPath });
    assert.equal(result.json.fvm_metrics.total, 100);
    assert.equal(result.json.fvm_metrics.passed, 60);
    assert.equal(result.json.fvm_metrics.pass_rate, 60);
  });
});

describe("act_analyze — combined audit + FVM", () => {
  let tmpDir, histPath, fvmPath;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "act-combined-"));
    histPath = join(tmpDir, "history.jsonl");
    fvmPath = join(tmpDir, "fvm.md");

    writeFileSync(histPath, [
      JSON.stringify({ timestamp: "2026-03-19T10:00:00Z", track: "X", verdict: "pending", rejection_codes: [{ code: "CC-2" }] }),
      JSON.stringify({ timestamp: "2026-03-19T10:01:00Z", track: "X", verdict: "pending", rejection_codes: [{ code: "CC-2" }] }),
      JSON.stringify({ timestamp: "2026-03-19T10:02:00Z", track: "X", verdict: "pending", rejection_codes: [{ code: "CC-2" }] }),
      JSON.stringify({ timestamp: "2026-03-19T10:03:00Z", track: "X", verdict: "agree", rejection_codes: [] }),
    ].join("\n"));

    writeFileSync(fvmPath, "Total: 50 rows, 45 passed, 5 failed\nAUTH_LEAK\nFALSE_DENY\nFALSE_DENY\n");
  });

  after(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("produces items from both sources", () => {
    const result = toolActAnalyze({
      audit_history_path: histPath,
      fvm_results_path: fvmPath,
    });
    assert.ok(!result.error);
    const auditItems = result.json.items.filter(i => i.source === "audit_history");
    const fvmItems = result.json.items.filter(i => i.source === "fvm_validate");
    assert.ok(auditItems.length > 0, "Should have audit-sourced items");
    assert.ok(fvmItems.length > 0, "Should have FVM-sourced items");
  });

  it("summary includes both metrics", () => {
    const result = toolActAnalyze({
      audit_history_path: histPath,
      fvm_results_path: fvmPath,
    });
    assert.ok(result.summary.includes("audit"));
    assert.ok(result.summary.includes("fvm"));
  });
});

describe("act_analyze — custom thresholds", () => {
  let tmpDir, histPath;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "act-thresh-"));
    histPath = join(tmpDir, "history.jsonl");
    writeFileSync(histPath, [
      JSON.stringify({ timestamp: "2026-03-19T10:00:00Z", verdict: "pending", rejection_codes: [{ code: "X-1" }] }),
      JSON.stringify({ timestamp: "2026-03-19T10:01:00Z", verdict: "pending", rejection_codes: [{ code: "X-1" }] }),
    ].join("\n"));
  });

  after(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("respects lowered repeat_rejection_warn threshold", () => {
    const result = toolActAnalyze({
      audit_history_path: histPath,
      thresholds: { repeat_rejection_warn: 2 },
    });
    const item = result.json.items.find(i => i.metric.includes("X-1"));
    assert.ok(item, "Should flag X-1 with threshold=2");
  });

  it("default threshold does not flag 2 occurrences", () => {
    const result = toolActAnalyze({ audit_history_path: histPath });
    const item = result.json.items.find(i => i.metric.includes("X-1"));
    assert.ok(!item, "Should not flag X-1 with default threshold=3");
  });
});
