#!/usr/bin/env node
/* global process, Buffer */

/**
 * TaskCompleted hook: enforce done-criteria before task completion.
 *
 * Only fires when CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 is set.
 * Runs structural quality checks (CQ + T) and blocks completion if any fail.
 *
 * Exit codes:
 *   0 — pass (task may be completed)
 *   2 — feedback (task stays in-progress, teammate continues with feedback)
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

const taskSubject = input.task_subject || "(unknown)";
const teammateName = input.teammate_name || "";

console.error(`[task-completed] Verifying: "${taskSubject}" by ${teammateName}`);

// ── Resolve repo root ────────────────────────────────────────
let REPO_ROOT;
try {
  REPO_ROOT = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
} catch {
  REPO_ROOT = process.cwd();
}

// ── Detect changed files (staged + unstaged + recent commits) ─
let changedFiles = [];
try {
  // Uncommitted changes
  const uncommitted = execSync("git diff --name-only && git diff --cached --name-only", {
    cwd: REPO_ROOT, encoding: "utf8",
  }).trim();

  // Recent commits (last 5) — covers worktree commit workflow
  let committed = "";
  try {
    committed = execSync("git diff --name-only HEAD~5..HEAD 2>/dev/null", {
      cwd: REPO_ROOT, encoding: "utf8",
    }).trim();
  } catch { /* shallow repo or <5 commits — skip */ }

  const all = `${uncommitted}\n${committed}`.trim();
  if (all) {
    changedFiles = [...new Set(all.split("\n").filter(Boolean))];
  }
} catch { /* no changes */ }

if (changedFiles.length === 0) {
  console.error("[task-completed] No changed files detected — passing through");
  process.exit(0);
}

// ── Run done-criteria checks ─────────────────────────────────
const failures = [];
const sourceFiles = changedFiles.filter(f => f.match(/\.(ts|tsx|js|jsx|mjs)$/));

// CQ-1: eslint per changed source file
for (const file of sourceFiles) {
  const fullPath = resolve(REPO_ROOT, file);
  if (!existsSync(fullPath)) continue;

  try {
    execSync(`npx eslint "${file}" --no-warn-ignored`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (e) {
    const output = e.stdout?.toString() || e.stderr?.toString() || "";
    failures.push(`[CQ-1] eslint: ${file}\n${output.slice(0, 200)}`);
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
  const output = e.stdout?.toString() || e.stderr?.toString() || "";
  failures.push(`[CQ-2] tsc --noEmit\n${output.slice(0, 300)}`);
}

// T-1: Run default test command (if package.json exists)
const pkgPath = resolve(REPO_ROOT, "package.json");
if (existsSync(pkgPath)) {
  try {
    const pkg = JSON.parse(execSync(`cat "${pkgPath}"`, { encoding: "utf8" }));
    const testCmd = pkg.scripts?.test;
    if (testCmd) {
      try {
        execSync(`npm test -- --run 2>&1`, {
          cwd: REPO_ROOT,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
          timeout: 60000,
        });
      } catch (e) {
        const output = e.stdout?.toString() || e.stderr?.toString() || "";
        failures.push(`[T-1] Tests failed\n${output.slice(-300)}`);
      }
    }
  } catch { /* package.json parse error — skip test */ }
}

// ── Verdict ──────────────────────────────────────────────────
if (failures.length > 0) {
  const feedback = [
    `🚫 Task "${taskSubject}" cannot be completed — ${failures.length} done-criteria failure(s):`,
    "",
    ...failures,
    "",
    "Fix these issues before marking the task as complete.",
  ].join("\n");

  process.stderr.write(feedback);
  process.exit(2); // Exit 2 = feedback, task stays in-progress
}

console.error(`[task-completed] All checks passed for: "${taskSubject}"`);
process.exit(0);
