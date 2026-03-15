#!/usr/bin/env node
/* global process, console */
/**
 * CL-1 direct verification:
 *   1. singleRe  — H1-H6 excluded, H7+ and other single-char IDs collected
 *   2. find_respond_file — plugin-dir first, repo-root fallback, custom name
 *
 * Run: node .claude/hooks/consensus-loop/tests/cl1-verify.test.mjs
 */

import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// ─── 1. singleRe H1-H6 exclusion ────────────────────────────────────────────
// Mirrors the collectIdsFromLine() singleRe block in respond.mjs (L512-L518).

function collectSingleIds(line) {
  const ids = new Set();
  const singleRe = /\b([A-Z])(\d{1,2})\b/g;
  let m;
  while ((m = singleRe.exec(line)) !== null) {
    const id = `${m[1]}${m[2]}`;
    if (/^H[1-6]$/.test(id)) continue;
    ids.add(id);
  }
  return [...ids];
}

console.log("singleRe H1-H6 exclusion:");

test("H1 is excluded", () => assert.deepStrictEqual(collectSingleIds("H1"), []));
test("H2 is excluded", () => assert.deepStrictEqual(collectSingleIds("H2"), []));
test("H3 is excluded", () => assert.deepStrictEqual(collectSingleIds("H3"), []));
test("H4 is excluded", () => assert.deepStrictEqual(collectSingleIds("H4"), []));
test("H5 is excluded", () => assert.deepStrictEqual(collectSingleIds("H5"), []));
test("H6 is excluded", () => assert.deepStrictEqual(collectSingleIds("H6"), []));
test("H7 is NOT excluded", () => assert.ok(collectSingleIds("H7").includes("H7")));
test("H10 is NOT excluded (two digits)", () => assert.ok(collectSingleIds("H10").includes("H10")));
test("E1 collected", () => assert.ok(collectSingleIds("E1").includes("E1")));
test("F2 collected among mixed line", () => {
  const ids = collectSingleIds("fix E1 and F2 near H3");
  assert.ok(ids.includes("E1"), "E1 missing");
  assert.ok(ids.includes("F2"), "F2 missing");
  assert.ok(!ids.includes("H3"), "H3 must be excluded");
});

// ─── 2. find_respond_file fallback ──────────────────────────────────────────
// Mirrors the find_respond_file() function in index.mjs (L45-L56).

function find_respond_file({ respond_file = "gpt.md", watch_file, plugin_dir, repo_root }) {
  const subPath = watch_file.split("/").slice(0, -1).join("/");
  const dirs = [
    join(plugin_dir, subPath),
    join(repo_root,  subPath),
  ];
  for (const dir of dirs) {
    for (const v of [respond_file, respond_file.toUpperCase(), respond_file.toLowerCase()]) {
      const p = join(dir, v);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

console.log("\nfind_respond_file fallback:");

const tmp = mkdtempSync(join(tmpdir(), "cl1-"));
try {
  const pluginDir = join(tmp, "plugin");
  const repoRoot  = join(tmp, "repo");
  mkdirSync(join(pluginDir, "feedback"), { recursive: true });
  mkdirSync(join(repoRoot,  "feedback"), { recursive: true });

  test("returns null when file absent in both dirs", () => {
    assert.strictEqual(
      find_respond_file({ watch_file: "feedback/claude.md", plugin_dir: pluginDir, repo_root: repoRoot }),
      null,
    );
  });

  test("resolves from plugin_dir first", () => {
    writeFileSync(join(pluginDir, "feedback", "gpt.md"), "");
    writeFileSync(join(repoRoot,  "feedback", "gpt.md"), "");
    const result = find_respond_file({ watch_file: "feedback/claude.md", plugin_dir: pluginDir, repo_root: repoRoot });
    assert.ok(result?.startsWith(pluginDir), `expected plugin_dir prefix, got: ${result}`);
  });

  test("falls back to repo_root when absent in plugin_dir", () => {
    rmSync(join(pluginDir, "feedback", "gpt.md"));
    const result = find_respond_file({ watch_file: "feedback/claude.md", plugin_dir: pluginDir, repo_root: repoRoot });
    assert.ok(result?.startsWith(repoRoot), `expected repo_root prefix, got: ${result}`);
  });

  test("uses default respond_file='gpt.md' when not specified", () => {
    const result = find_respond_file({ watch_file: "feedback/claude.md", plugin_dir: pluginDir, repo_root: repoRoot });
    assert.ok(result?.endsWith("gpt.md"), `expected gpt.md suffix, got: ${result}`);
  });

  test("respects custom respond_file name", () => {
    writeFileSync(join(repoRoot, "feedback", "custom.md"), "");
    const result = find_respond_file({ respond_file: "custom.md", watch_file: "feedback/claude.md", plugin_dir: pluginDir, repo_root: repoRoot });
    assert.ok(result?.endsWith("custom.md"), `expected custom.md suffix, got: ${result}`);
  });

  test("case-insensitive match (uppercase variant)", () => {
    rmSync(join(repoRoot, "feedback", "gpt.md"));
    writeFileSync(join(repoRoot, "feedback", "GPT.MD"), "");
    const result = find_respond_file({ watch_file: "feedback/claude.md", plugin_dir: pluginDir, repo_root: repoRoot });
    assert.ok(result?.toUpperCase().endsWith("GPT.MD"), `expected GPT.MD match, got: ${result}`);
  });

} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
