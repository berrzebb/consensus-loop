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

import { existsSync, readFileSync } from "node:fs";
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
    shell: true,
  }).trim();
  if (diff) {
    changedFiles = [...new Set(diff.split("\n").filter(Boolean))];
  }
} catch { /* no changes — pass */ }

if (changedFiles.length === 0) {
  // No changes to validate — allow idle
  process.exit(0);
}

// ── Run quality checks (language-aware) ──────────────────────
const failures = [];

// Load quality_rules presets from config
let presets = [];
try {
  const configPath = resolve(REPO_ROOT, ".claude", "quorum", "config.json");
  if (existsSync(configPath)) {
    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    presets = cfg.quality_rules?.presets ?? [];
  }
} catch { /* config read error */ }

const activePresets = presets
  .filter(p => existsSync(resolve(REPO_ROOT, p.detect)))
  .sort((a, b) => (a.precedence ?? 50) - (b.precedence ?? 50));

if (activePresets.length > 0) {
  for (const preset of activePresets) {
    for (const check of preset.checks ?? []) {
      if (check.per_file) {
        for (const file of changedFiles) {
          const fullPath = resolve(REPO_ROOT, file);
          if (!existsSync(fullPath)) continue;
          const cmd = check.command.replace("{file}", file);
          try {
            execSync(cmd, {
              cwd: REPO_ROOT,
              encoding: "utf8",
              stdio: ["pipe", "pipe", "pipe"],
              timeout: 30000,
              shell: true,
            });
          } catch (e) {
            if (check.optional) continue;
            const output = e.stdout?.toString() || e.stderr?.toString() || "";
            failures.push(`[${check.id}] ${check.label}: ${file}\n${output.slice(0, 200)}`);
          }
        }
      } else {
        try {
          execSync(check.command, {
            cwd: REPO_ROOT,
            encoding: "utf8",
            stdio: ["pipe", "pipe", "pipe"],
            timeout: 60000,
            shell: true,
          });
        } catch (e) {
          if (check.optional) continue;
          const output = e.stdout?.toString() || e.stderr?.toString() || "";
          failures.push(`[${check.id}] ${check.label}\n${output.slice(-300)}`);
        }
      }
    }
  }
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
