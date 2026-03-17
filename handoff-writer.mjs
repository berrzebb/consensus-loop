#!/usr/bin/env node

/**
 * Handoff Writer — sync session-handoff between repo and Claude memory.
 *
 * Replaces the external .claude/scripts/sync-handoff.mjs dependency.
 * The plugin now carries its own handoff sync logic for portability.
 *
 * Usage (from session-stop.mjs):
 *   import { syncHandoffToMemory } from "./handoff-writer.mjs";
 *   syncHandoffToMemory(repoRoot, handoffRelPath);
 *
 * Memory directory auto-discovery:
 *   1. Compute expected slug from repo root path (case-preserving)
 *   2. Verify directory exists at ~/.claude/projects/<slug>/memory/
 *   3. Fallback: case-insensitive match
 *   4. Fallback: multi-segment scan
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

// ── Slug computation ─────────────────────────────────────

/**
 * Compute the Claude Code project slug from an absolute path.
 *
 * Algorithm (verified against actual ~/.claude/projects/ entries):
 *   - Replace every non-alphanumeric-non-hyphen char with '-'
 *   - Preserve original case (Claude Code does NOT lowercase)
 *   - Strip leading/trailing hyphens
 *
 * Examples:
 *   "d:\\claude-tools\\.claude\\mcp-servers\\slack\\next"
 *     → "d--claude-tools--claude-mcp-servers-slack-next"
 *   "D:\\Trader"
 *     → "D--Trader"
 *   "/home/user/project"
 *     → "home-user-project"  (leading hyphen stripped)
 */
export function projectSlug(absPath) {
  return absPath.replace(/[^a-zA-Z0-9-]/g, "-").replace(/^-+|-+$/g, "");
}

// ── Memory directory resolution ──────────────────────────

/**
 * Find the Claude Code memory directory for a given repo root.
 * Returns the absolute path to the memory/ dir, or null if not found.
 */
export function findMemoryDir(repoRoot) {
  const claudeProjectsDir = resolve(homedir(), ".claude", "projects");
  if (!existsSync(claudeProjectsDir)) return null;

  const slug = projectSlug(repoRoot);

  // 1. Exact match (fast path)
  const exactDir = resolve(claudeProjectsDir, slug, "memory");
  if (existsSync(exactDir)) return exactDir;

  // 2. Case-insensitive match (Windows drive letter D: vs d:)
  let entries;
  try { entries = readdirSync(claudeProjectsDir); } catch { return null; }

  const slugLower = slug.toLowerCase();
  for (const entry of entries) {
    if (entry.toLowerCase() !== slugLower) continue;
    const memDir = resolve(claudeProjectsDir, entry, "memory");
    if (existsSync(memDir)) return memDir;
  }

  // 3. Multi-segment fallback — extract meaningful segments from the full path
  //    and require ALL to be present in the candidate directory name.
  //    Use full path segments (not just basename) to avoid false matches
  //    on generic names like "next" or "app".
  const pathSegments = repoRoot
    .replace(/[^a-zA-Z0-9-]/g, "-")   // same transform as slug
    .split(/-+/)                        // split on hyphens
    .filter((s) => s.length >= 3);      // skip short segments (d, C, etc.)

  if (pathSegments.length < 2) return null;  // not enough to disambiguate

  for (const entry of entries) {
    const memDir = resolve(claudeProjectsDir, entry, "memory");
    if (!existsSync(memDir)) continue;

    const entryLower = entry.toLowerCase();
    const allMatch = pathSegments.every((seg) => entryLower.includes(seg.toLowerCase()));
    if (allMatch) return memDir;
  }

  return null;
}

// ── Frontmatter helpers ──────────────────────────────────

const FRONTMATTER_TEMPLATES = {
  ko: {
    name: "세션 핸드오프",
    description: "진행 중인 작업 목록 — 세션 시작 시 반드시 읽고 이어할 작업 확인",
  },
  en: {
    name: "Session Handoff",
    description: "Active task list — read at session start to resume pending work",
  },
};

function buildFrontmatter(locale) {
  const tmpl = FRONTMATTER_TEMPLATES[locale] ?? FRONTMATTER_TEMPLATES.en;
  return `---\nname: ${tmpl.name}\ndescription: ${tmpl.description}\ntype: project\n---\n\n`;
}

// ── Sync operations ──────────────────────────────────────

/**
 * Sync handoff from repo to Claude memory directory.
 *
 * @param {string} repoRoot - Absolute path to the repository root
 * @param {string} handoffRelPath - Relative path to handoff file
 * @param {{ locale?: string }} [opts]
 * @returns {{ success: boolean, memoryDir?: string, error?: string }}
 */
export function syncHandoffToMemory(repoRoot, handoffRelPath, opts = {}) {
  const repoHandoff = resolve(repoRoot, handoffRelPath);
  if (!existsSync(repoHandoff)) {
    return { success: false, error: "repo_handoff_not_found" };
  }

  const memoryDir = findMemoryDir(repoRoot);
  if (!memoryDir) {
    return { success: false, error: "memory_dir_not_found" };
  }

  const content = readFileSync(repoHandoff, "utf8");

  // Write as memory-format file with frontmatter (locale-aware)
  const memoryContent = content.startsWith("---")
    ? content  // Already has frontmatter
    : buildFrontmatter(opts.locale ?? "en") + content;

  const memoryFile = resolve(memoryDir, "session_handoff.md");
  if (!existsSync(memoryDir)) mkdirSync(memoryDir, { recursive: true });
  writeFileSync(memoryFile, memoryContent, "utf8");

  return { success: true, memoryDir };
}

/**
 * Sync handoff from Claude memory to repo (reverse direction).
 * Used at session start to ensure repo file is up to date.
 *
 * @param {string} repoRoot - Absolute path to the repository root
 * @param {string} handoffRelPath - Relative path to handoff file
 * @returns {{ success: boolean, updated: boolean }}
 */
export function syncHandoffFromMemory(repoRoot, handoffRelPath) {
  const memoryDir = findMemoryDir(repoRoot);
  if (!memoryDir) return { success: false, updated: false };

  const memoryFile = resolve(memoryDir, "session_handoff.md");
  if (!existsSync(memoryFile)) return { success: false, updated: false };

  const memContent = readFileSync(memoryFile, "utf8");
  const repoHandoff = resolve(repoRoot, handoffRelPath);
  const repoContent = existsSync(repoHandoff) ? readFileSync(repoHandoff, "utf8") : "";

  // Skip if content is identical
  if (memContent === repoContent) return { success: true, updated: false };

  // Write memory content to repo (preserving frontmatter if present)
  const repoDir = resolve(repoRoot, handoffRelPath, "..");
  if (!existsSync(repoDir)) mkdirSync(repoDir, { recursive: true });
  writeFileSync(repoHandoff, memContent, "utf8");

  return { success: true, updated: true };
}

// ── CLI entry point ──────────────────────────────────────
// Allows standalone execution: node handoff-writer.mjs [repo-root] [handoff-path]

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { REPO_ROOT, cfg, plugin } = await import("./context.mjs");
  const handoffFile = cfg.plugin?.handoff_file ?? ".claude/session-handoff.md";
  const locale = plugin.locale ?? "en";
  const result = syncHandoffToMemory(REPO_ROOT, handoffFile, { locale });

  if (result.success) {
    console.log(`[handoff] Synced to memory: ${result.memoryDir}`);
  } else {
    console.log(`[handoff] Skip: ${result.error}`);
  }
}
