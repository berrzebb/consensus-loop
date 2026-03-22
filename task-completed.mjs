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
    cwd: REPO_ROOT, encoding: "utf8", shell: true,
  }).trim();

  // Recent commits (last 5) — covers worktree commit workflow
  let committed = "";
  try {
    committed = execSync("git diff --name-only HEAD~5..HEAD 2>/dev/null", {
      cwd: REPO_ROOT, encoding: "utf8", shell: true,
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

// ── Run done-criteria checks (language-aware) ────────────────
const failures = [];

// Load quality_rules presets from config
let presets = [];
try {
  const configPath = resolve(REPO_ROOT, ".claude", "quorum", "config.json");
  if (existsSync(configPath)) {
    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    presets = cfg.quality_rules?.presets ?? [];
  }
} catch { /* config read error — fall through to empty presets */ }

// Find matching presets by detect file presence, sorted by precedence
const activePresets = presets
  .filter(p => existsSync(resolve(REPO_ROOT, p.detect)))
  .sort((a, b) => (a.precedence ?? 50) - (b.precedence ?? 50));

if (activePresets.length > 0) {
  for (const preset of activePresets) {
    for (const check of preset.checks ?? []) {
      if (check.per_file) {
        // Per-file checks: run for each changed file
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
        // Whole-project checks
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
} else {
  console.error("[task-completed] No quality_rules presets matched — skipping CQ checks");
}

// ── No-abandon gate: evidence must exist before task completion ──
try {
  const configPath = resolve(REPO_ROOT, ".claude", "quorum", "config.json");
  if (existsSync(configPath)) {
    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    const watchFile = cfg.consensus?.watch_file ?? "docs/feedback/claude.md";
    const evidencePath = resolve(REPO_ROOT, watchFile);
    if (existsSync(evidencePath)) {
      const evidence = readFileSync(evidencePath, "utf8");
      const triggerTag = cfg.consensus?.trigger_tag ?? "[REVIEW_NEEDED]";
      if (!evidence.includes(triggerTag) && !evidence.includes("[APPROVED]") && !evidence.includes("[INFRA_FAILURE]")) {
        failures.push("[NO-ABANDON] Evidence file exists but contains no submission tag. Submit evidence before completing task.");
      }
    } else {
      failures.push("[NO-ABANDON] Evidence file not found. Submit evidence to watch_file before completing task.");
    }
  }
} catch { /* config read error — skip gate */ }

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

// ── Emit task completion to EventStore ──
try {
  const bridge = await import("../../core/bridge.mjs");
  const REPO_ROOT = process.cwd();
  await bridge.init(REPO_ROOT);
  bridge.emitEvent("agent.complete", "claude-code", {
    name: teammateName || taskSubject,
    task: taskSubject,
  });
  bridge.close();
} catch { /* bridge non-critical */ }

console.error(`[task-completed] All checks passed for: "${taskSubject}"`);
process.exit(0);
