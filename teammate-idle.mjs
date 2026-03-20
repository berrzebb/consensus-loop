#!/usr/bin/env node
/* global process, Buffer */

/**
 * TeammateIdle hook: quality gate before a teammate goes idle.
 *
 * Only fires when CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 is set.
 * Runs CQ (lint + tsc) checks on changed files.
 *
 * Exit codes:
 *   0 — pass (teammate may go idle)
 *   2 — feedback (teammate continues working with the feedback message)
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

// ── Read stdin ───────────────────────────────────────────────
let input;
try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) process.exit(0);
  input = JSON.parse(raw);
} catch {
  process.exit(0);
}

const teammateName = input.teammate_name || "";

// Only gate implementer teammates
if (!teammateName.includes("implementer")) {
  process.exit(0);
}

// ── Resolve repo root ────────────────────────────────────────
let REPO_ROOT;
try {
  REPO_ROOT = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
} catch {
  REPO_ROOT = process.cwd();
}

// ── Check for uncommitted or staged changes ──────────────────
let changedFiles = [];
try {
  const diff = execSync("git diff --name-only && git diff --cached --name-only", {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
  if (diff) {
    changedFiles = [...new Set(diff.split("\n").filter(Boolean))];
  }
} catch { /* no changes — pass */ }

if (changedFiles.length === 0) {
  // No changes to validate — allow idle
  process.exit(0);
}

// ── Run quality checks ───────────────────────────────────────
const failures = [];

// CQ-1: eslint per changed file
for (const file of changedFiles) {
  if (!file.match(/\.(ts|tsx|js|jsx|mjs)$/)) continue;
  const fullPath = resolve(REPO_ROOT, file);
  if (!existsSync(fullPath)) continue;

  try {
    execSync(`npx eslint "${file}" --no-warn-ignored`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (e) {
    const stderr = e.stderr?.toString() || e.stdout?.toString() || "";
    failures.push(`[CQ-1] eslint failed: ${file}\n${stderr.slice(0, 200)}`);
  }
}

// CQ-2: tsc --noEmit
try {
  execSync("npx tsc --noEmit", {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 30000,
  });
} catch (e) {
  const stderr = e.stderr?.toString() || e.stdout?.toString() || "";
  failures.push(`[CQ-2] tsc --noEmit failed\n${stderr.slice(0, 300)}`);
}

// ── Verdict ──────────────────────────────────────────────────
if (failures.length > 0) {
  const feedback = [
    `⚠️ Quality gate failed (${failures.length} issue${failures.length > 1 ? "s" : ""}).`,
    `Fix before going idle:`,
    "",
    ...failures,
  ].join("\n");

  process.stderr.write(feedback);
  process.exit(2); // Exit 2 = feedback, teammate continues
}

process.exit(0); // All checks passed — allow idle
