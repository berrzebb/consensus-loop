#!/usr/bin/env node
/* global process, Buffer */

/**
 * WorktreeRemove hook: clean up after agent worktree is removed.
 *
 * 1. Preserve evidence (watch_file) from worktree before removal
 * 2. Update handoff state — mark worktree branch as completed
 * 3. Clean up git worktree reference
 *
 * Non-blocking — failures are logged but do not prevent removal.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, basename, dirname } from "node:path";
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

const worktreePath = input.worktree_path || "";
if (!worktreePath) process.exit(0);

const worktreeName = basename(worktreePath);

// ── Resolve main repo root ───────────────────────────────────
let REPO_ROOT;
try {
  // WorktreeRemove fires from main session, so cwd is the main repo
  REPO_ROOT = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
} catch {
  REPO_ROOT = process.cwd();
}

// ── 1. Preserve evidence from worktree ───────────────────────
try {
  const { consensus } = await import("./context.mjs");
  const worktreeWatchFile = resolve(worktreePath, consensus.watch_file);

  if (existsSync(worktreeWatchFile)) {
    const evidence = readFileSync(worktreeWatchFile, "utf8");

    // Archive to main repo's evidence history
    const archiveDir = resolve(REPO_ROOT, ".claude", "evidence-archive");
    mkdirSync(archiveDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const archivePath = resolve(archiveDir, `${worktreeName}-${timestamp}.md`);
    writeFileSync(archivePath, evidence, "utf8");

    console.error(`[worktree-remove] Preserved evidence → ${archivePath}`);
  }
} catch (e) {
  console.error(`[worktree-remove] Evidence preservation warning: ${e.message}`);
}

// ── 2. Read worktree metadata ────────────────────────────────
let meta = null;
try {
  const metaPath = resolve(worktreePath, ".claude", "worktree-meta.json");
  if (existsSync(metaPath)) {
    meta = JSON.parse(readFileSync(metaPath, "utf8"));
    console.error(`[worktree-remove] Worktree meta: branch=${meta.branch}, created=${meta.created_at}`);
  }
} catch { /* metadata read failure — non-fatal */ }

// ── 3. Clean up git worktree ─────────────────────────────────
try {
  if (existsSync(worktreePath)) {
    execSync(`git worktree remove --force "${worktreePath}"`, {
      cwd: REPO_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
    });
    console.error(`[worktree-remove] Removed worktree: ${worktreePath}`);
  }
} catch (e) {
  console.error(`[worktree-remove] git worktree remove warning: ${e.message}`);
}

// ── 4. Clean up branch (if worktree had no changes) ──────────
try {
  if (meta?.branch) {
    // Check if branch has any commits beyond the parent
    const log = execSync(`git log --oneline "main..${meta.branch}" 2>/dev/null`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();

    if (!log) {
      // No unique commits — safe to delete the branch
      execSync(`git branch -d "${meta.branch}" 2>/dev/null`, {
        cwd: REPO_ROOT,
        stdio: ["pipe", "pipe", "pipe"],
      });
      console.error(`[worktree-remove] Cleaned up empty branch: ${meta.branch}`);
    } else {
      console.error(`[worktree-remove] Branch ${meta.branch} has ${log.split("\n").length} commit(s) — preserved`);
    }
  }
} catch { /* branch cleanup failure — non-fatal */ }

process.exit(0);
