#!/usr/bin/env node
/* global process, Buffer */

/**
 * WorktreeCreate hook: create and configure an isolated worktree for agents.
 *
 * 1. Creates a git worktree with an orphan branch
 * 2. Copies consensus-loop config + templates into the worktree
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

const worktreeDir = resolve(REPO_ROOT, ".claude", "worktrees", name);
const branchName = `worktree/${name}`;

// ── Create worktree ──────────────────────────────────────────
try {
  if (!existsSync(resolve(REPO_ROOT, ".claude", "worktrees"))) {
    mkdirSync(resolve(REPO_ROOT, ".claude", "worktrees"), { recursive: true });
  }

  // Create worktree with a new branch from current HEAD
  execSync(`git worktree add -b "${branchName}" "${worktreeDir}" HEAD`, {
    cwd: REPO_ROOT,
    stdio: ["pipe", "pipe", "pipe"],
  });

  console.error(`[worktree-create] Created worktree: ${worktreeDir} (branch: ${branchName})`);
} catch (e) {
  console.error(`[worktree-create] git worktree add failed: ${e.message}`);
  process.exit(1);
}

// ── Copy consensus-loop config + templates ───────────────────
try {
  const projectConfigDir = resolve(REPO_ROOT, ".claude", "consensus-loop");
  const worktreeConfigDir = resolve(worktreeDir, ".claude", "consensus-loop");

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
  const { consensus } = await import("./context.mjs");
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
  const settingsSrc = resolve(REPO_ROOT, ".claude", "settings.json");
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

  const settingsLocalSrc = resolve(REPO_ROOT, ".claude", "settings.local.json");
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
    parent_repo: REPO_ROOT,
  }, null, 2), "utf8");

} catch (e) {
  // Config copy failure is non-fatal — worktree still usable
  console.error(`[worktree-create] Config setup warning: ${e.message}`);
}

// ── Output worktree path (REQUIRED) ──────────────────────────
// Claude Code reads stdout to determine the worktree directory
process.stdout.write(worktreeDir);
process.exit(0);
