#!/usr/bin/env node
/* global process, Buffer */

/**
 * WorktreeCreate hook: create and configure an isolated worktree for agents.
 *
 * 1. Creates a git worktree with an orphan branch
 * 2. Copies quorum config + templates into the worktree
 * 3. Prints the absolute worktree path to stdout (required by Claude Code)
 *
 * All non-path output MUST go to stderr. Only the worktree path goes to stdout.
 */

import { existsSync, mkdirSync, cpSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Read stdin ───────────────────────────────────────────────
let input;
try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) { console.error("[worktree-create] No stdin"); process.exit(1); }
  input = JSON.parse(raw);
} catch (e) {
  console.error(`[worktree-create] stdin parse error: ${e.message}`);
  process.exit(1);
}

const name = input.name || `agent-${Date.now().toString(36)}`;

// ── Resolve paths ────────────────────────────────────────────
let REPO_ROOT;
try {
  REPO_ROOT = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
} catch {
  REPO_ROOT = process.cwd();
}

// ── Invariant: worktree depth = 1 (no nesting) ──────────────
// If REPO_ROOT is already inside a worktree, resolve to the real main repo.
let MAIN_ROOT = REPO_ROOT;
try {
  const gitDir = execSync("git rev-parse --git-dir", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  // Worktrees have gitdir like: /path/to/main/.git/worktrees/<name>
  if (gitDir.includes("/worktrees/") || gitDir.includes("\\worktrees\\")) {
    const commonDir = execSync("git rev-parse --git-common-dir", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
    MAIN_ROOT = resolve(REPO_ROOT, commonDir, "..");
    console.error(`[worktree-create] Detected nested context — resolving to main repo: ${MAIN_ROOT}`);
  }
} catch { /* not a worktree — MAIN_ROOT stays as REPO_ROOT */ }

const worktreeDir = resolve(MAIN_ROOT, ".claude", "worktrees", name);
const branchName = `worktree/${name}`;

// Guard: reject if target path already contains .claude/worktrees/
if (worktreeDir.includes(".claude/worktrees/") || worktreeDir.includes(".claude\\worktrees\\")) {
  const segments = worktreeDir.split(/[/\\]/).filter(s => s === "worktrees").length;
  if (segments > 1) {
    console.error(`[worktree-create] BLOCKED: nested worktree detected (depth ${segments}). Worktree depth must be 1.`);
    process.exit(1);
  }
}

// ── Create worktree ──────────────────────────────────────────
try {
  if (!existsSync(resolve(MAIN_ROOT, ".claude", "worktrees"))) {
    mkdirSync(resolve(MAIN_ROOT, ".claude", "worktrees"), { recursive: true });
  }

  // Create worktree with a new branch from current HEAD (always from main repo)
  execSync(`git worktree add -b "${branchName}" "${worktreeDir}" HEAD`, {
    cwd: MAIN_ROOT,
    stdio: ["pipe", "pipe", "pipe"],
    shell: true,
  });

  console.error(`[worktree-create] Created worktree: ${worktreeDir} (branch: ${branchName})`);
} catch (e) {
  console.error(`[worktree-create] git worktree add failed: ${e.message}`);
  process.exit(1);
}

// ── Copy quorum config + templates ───────────────────
try {
  const projectConfigDir = resolve(MAIN_ROOT, ".claude", "quorum");
  const worktreeConfigDir = resolve(worktreeDir, ".claude", "quorum");

  if (existsSync(projectConfigDir)) {
    mkdirSync(worktreeConfigDir, { recursive: true });

    // Copy config.json
    const configSrc = resolve(projectConfigDir, "config.json");
    if (existsSync(configSrc)) {
      cpSync(configSrc, resolve(worktreeConfigDir, "config.json"));
      console.error("[worktree-create] Copied config.json");
    }

    // Copy templates directory
    const templatesSrc = resolve(projectConfigDir, "templates");
    if (existsSync(templatesSrc)) {
      cpSync(templatesSrc, resolve(worktreeConfigDir, "templates"), { recursive: true });
      console.error("[worktree-create] Copied templates/");
    }
  }

  // Create watch_file directory in worktree
  const { consensus } = await import("../../core/context.mjs");
  const watchDir = dirname(resolve(worktreeDir, consensus.watch_file));
  if (!existsSync(watchDir)) {
    mkdirSync(watchDir, { recursive: true });
    console.error(`[worktree-create] Created watch_file dir: ${watchDir}`);
  }

  // Generate .claude/settings.json with agent permissions
  // Headless agents need tool permissions without prompts.
  // Instead of bypassPermissions, inject explicit allow list so deny rules still work.
  const claudeDir = resolve(worktreeDir, ".claude");
  mkdirSync(claudeDir, { recursive: true });
  const settingsSrc = resolve(MAIN_ROOT, ".claude", "settings.json");
  const parentSettings = existsSync(settingsSrc)
    ? JSON.parse(readFileSync(settingsSrc, "utf8"))
    : {};
  const agentTools = ["Read", "Write", "Edit", "Bash(*)", "Glob", "Grep", "WebFetch(*)", "WebSearch"];
  const existingAllow = parentSettings.permissions?.allow || [];
  const mergedAllow = [...new Set([...existingAllow, ...agentTools])];
  parentSettings.permissions = {
    ...parentSettings.permissions,
    allow: mergedAllow,
    defaultMode: parentSettings.permissions?.defaultMode || "default",
  };
  writeFileSync(
    resolve(claudeDir, "settings.json"),
    JSON.stringify(parentSettings, null, 2),
    "utf8",
  );
  console.error(`[worktree-create] Generated .claude/settings.json (${mergedAllow.length} allow rules)`);

  const settingsLocalSrc = resolve(MAIN_ROOT, ".claude", "settings.local.json");
  if (existsSync(settingsLocalSrc)) {
    cpSync(settingsLocalSrc, resolve(claudeDir, "settings.local.json"));
    console.error("[worktree-create] Copied .claude/settings.local.json");
  }

  // Write worktree metadata for tracking
  const metaPath = resolve(claudeDir, "worktree-meta.json");
  writeFileSync(metaPath, JSON.stringify({
    name,
    branch: branchName,
    created_at: new Date().toISOString(),
    parent_repo: MAIN_ROOT,
  }, null, 2), "utf8");

} catch (e) {
  // Config copy failure is non-fatal — worktree still usable
  console.error(`[worktree-create] Config setup warning: ${e.message}`);
}

// ── Output worktree path (REQUIRED) ──────────────────────────
// Claude Code reads stdout to determine the worktree directory
process.stdout.write(worktreeDir);
process.exit(0);
