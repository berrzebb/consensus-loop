#!/usr/bin/env node
/**
 * Hook: SessionStart
 * Loads handoff + recent changes + audit state as context for new sessions.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { syncHandoffFromMemory } from "./handoff-writer.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// cwd-based git resolution (worktree-aware) — legacy layout as fallback
function resolveRepoRoot() {
  try {
    return execSync("git rev-parse --show-toplevel", { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
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
const watchFile = cfg.consensus?.watch_file ?? "docs/feedback/claude.md";
const respondFile = cfg.plugin?.respond_file ?? "gpt.md";

let context = "";

// 0. Sync handoff from memory to repo (memory may be newer from another machine/session)
const handoffFile = cfg.plugin?.handoff_file ?? ".claude/session-handoff.md";
try {
  syncHandoffFromMemory(REPO_ROOT, handoffFile);
} catch { /* non-fatal — writeFileSync failure must not crash the hook */ }

// 1. Session handoff (path from config or default)
const handoff = resolve(REPO_ROOT, handoffFile);
if (existsSync(handoff)) {
  const content = readFileSync(handoff, "utf8").trim();
  if (content) context += `Session Handoff:\n${content}\n\n`;
}

// 2. Recent git commits
try {
  const commits = execSync("git log --oneline -10", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  if (commits) context += `Recent commits:\n${commits}\n\n`;
} catch { /* git unavailable */ }

// 3. Current audit status (from config paths)
const watchDir = resolve(REPO_ROOT, watchFile, "..");
const gptMd = resolve(watchDir, respondFile);
if (existsSync(gptMd)) {
  const lines = readFileSync(gptMd, "utf8").split("\n");
  const firstLine = lines.find((l) => l.trim().startsWith("- "));
  if (firstLine) context += `Current audit status: ${firstLine.trim()}\n`;
}

// 4. Active audit lock
const auditLock = resolve(REPO_ROOT, ".claude", "audit.lock");
if (existsSync(auditLock)) {
  context += "⚠ Background audit in progress (audit.lock exists)\n";
}

// 5. Deferred retrospective from subagent
const retroMarker = resolve(__dirname, ".session-state", "retro-marker.json");
if (existsSync(retroMarker)) {
  try {
    const marker = JSON.parse(readFileSync(retroMarker, "utf8"));
    if (marker.retro_pending && marker.deferred_to_orchestrator) {
      context += `\n[ACTION REQUIRED — DEFERRED RETROSPECTIVE]\n`;
      context += `Subagent session triggered retrospective (${marker.rx_id ?? "unknown"}) but deferred it to this session.\n`;
      if (marker.agreed_items) {
        context += `Agreed items:\n${marker.agreed_items}\n`;
      }
      context += `\nComplete the retrospective protocol:\n`;
      context += `1. Review what went well / what went wrong\n`;
      context += `2. Exchange feedback with user\n`;
      context += `3. Save repeatable principles to memory\n`;
      context += `4. echo session-self-improvement-complete\n`;
    } else if (marker.retro_pending && !marker.deferred_to_orchestrator) {
      context += `\n⚠ Pending retrospective (${marker.rx_id ?? "unknown"}) — session-gate will enforce the protocol.\n`;
    }
  } catch { /* marker parse error — non-fatal */ }
}

// Output as JSON for Claude Code hook system
if (context) {
  const escaped = JSON.stringify(context);
  process.stdout.write(`{"additionalContext": ${escaped}}`);
}
