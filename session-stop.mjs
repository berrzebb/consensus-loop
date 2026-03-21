#!/usr/bin/env node
/**
 * Hook: Stop
 * On session end: sync handoff + auto-commit session artifacts.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { syncHandoffToMemory } from "./handoff-writer.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// cwd-based git resolution (worktree-aware) — legacy layout as fallback
function resolveRepoRoot() {
  try {
    const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    if (r.status === 0) return r.stdout.trim();
  } catch { /* git unavailable */ }
  const legacy = resolve(__dirname, "..", "..", "..");
  if (existsSync(resolve(legacy, ".git"))) return legacy;
  return process.cwd();
}
const REPO_ROOT = resolveRepoRoot();

// Read config — prefer CLAUDE_PLUGIN_ROOT (set by hooks.json), fallback to __dirname
const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
const configPath = (() => {
  if (pluginRoot) {
    const p = resolve(pluginRoot, "config.json");
    if (existsSync(p)) return p;
  }
  return resolve(__dirname, "config.json");
})();
const cfg = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};
const handoffFile = cfg.plugin?.handoff_file ?? ".claude/session-handoff.md";

/** Run git with args array — no shell interpolation, no injection. */
function git(args, cwd) {
  try {
    const r = spawnSync("git", args, { cwd: cwd ?? REPO_ROOT, encoding: "utf8", stdio: "pipe" });
    return r.status === 0 ? (r.stdout || "").trim() : null;
  } catch {
    return null;
  }
}

// 1. Sync handoff from repo to memory (plugin-internal, no external script)
const locale = cfg.plugin?.locale ?? "en";
try {
  syncHandoffToMemory(REPO_ROOT, handoffFile, { locale });
} catch { /* non-fatal — writeFileSync failure must not crash the hook */ }

// 2. quorum repo: auto-commit if changes exist
const clDir = __dirname;
if (existsSync(resolve(clDir, ".git"))) {
  const status = git(["diff", "--name-only"], clDir);
  if (status) {
    git(["add", "-u"], clDir);
    const diff = git(["diff", "--cached", "--stat"], clDir) || "";
    git(["commit", "-m", `WIP: auto-commit session changes\n\n${diff}`, "--no-verify"], clDir);
    git(["push", "origin", "main"], clDir);
  }
}

// 3. Main repo: stage session artifacts only
// handoffFile은 메모리 동기화(handoff-writer)로 관리 — git 커밋 불필요
const artifacts = [
  ".claude/CLAUDE.md",
];

for (const f of artifacts) {
  const fullPath = resolve(REPO_ROOT, f);
  if (existsSync(fullPath)) {
    git(["add", f]);
  }
}

const staged = git(["diff", "--cached", "--name-only"]);
if (staged) {
  const diff = git(["diff", "--cached", "--stat"]) || "";
  git(["commit", "-m", `chore: auto-commit session artifacts\n\n${diff}\n\nCo-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>`, "--no-verify"]);
}

// ── Auto-update RTM statuses on session end ──
try {
  const { updateAllRtms } = await import("../../core/rtm-updater.mjs");
  const results = updateAllRtms(REPO_ROOT);
  if (results.length > 0) {
    const total = results.reduce((s, r) => s + r.updated, 0);
    console.error(`[quorum] RTM auto-updated: ${total} row(s)`);
  }
} catch (e) { console.error(`[quorum] RTM update warning: ${e.message}`); }
