#!/usr/bin/env node
/**
 * Shared context module — config, paths, tag constants, markdown parser, i18n cache.
 *
 * All consensus-loop scripts import from this module to avoid
 * duplicate config parsing, path resolution, and function implementations.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

// ── Paths ─────────────────────────────────────────────────
export const HOOKS_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the repository root directory.
 *
 * Worktree-aware: cwd-based git resolution runs first so that
 * subagents running inside a git worktree see the worktree root,
 * not the main repo root.
 *
 * Legacy layout:  .claude/hooks/consensus-loop/  → 3 levels up (fallback)
 * Plugin layout:  installed anywhere              → git rev-parse (primary)
 *
 * Falls back to process.cwd() when git is unavailable.
 */
function resolveRepoRoot() {
  // 1. cwd-based git resolution — worktree-aware (primary)
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch { /* git not available or not in a repo */ }

  // 2. Legacy layout fallback: .claude/hooks/consensus-loop/ → 3 levels up
  const legacyRoot = resolve(HOOKS_DIR, "..", "..", "..");
  if (existsSync(resolve(legacyRoot, ".git"))) return legacyRoot;

  // 3. Last resort
  return process.cwd();
}

export const REPO_ROOT = resolveRepoRoot();

// ── Config ────────────────────────────────────────────────

/**
 * Find config.json path.
 *
 * Priority:
 *   1. $CLAUDE_PLUGIN_ROOT/config.json — set by hooks.json; always the canonical plugin dir
 *   2. HOOKS_DIR/config.json            — fallback for direct CLI invocation
 *
 * This ensures worktree copies (which lack config.json) can still load config
 * when hooks.json has set CLAUDE_PLUGIN_ROOT to the main plugin location.
 */
function findConfigPath() {
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (pluginRoot) {
    const p = resolve(pluginRoot, "config.json");
    if (existsSync(p)) return p;
  }
  const local = resolve(HOOKS_DIR, "config.json");
  if (existsSync(local)) return local;
  return null;
}

const _configPath = findConfigPath();

/** config.json이 존재하지 않으면 true. 훅에서 설정 안내를 출력할 때 사용. */
export const configMissing = _configPath === null;

/** config.json 미존재 시 훅이 crash하지 않도록 최소 기본값 제공. */
const DEFAULT_CONFIG = {
  plugin: { locale: "en", hooks_enabled: {} },
  consensus: {
    watch_file: "docs/feedback/claude.md",
    trigger_tag: "[REVIEW_NEEDED]",
    agree_tag: "[APPROVED]",
    pending_tag: "[CHANGES_REQUESTED]",
  },
};

export const cfg = _configPath
  ? JSON.parse(readFileSync(_configPath, "utf8"))
  : DEFAULT_CONFIG;
export const plugin = cfg.plugin ?? DEFAULT_CONFIG.plugin;
export const consensus = cfg.consensus ?? DEFAULT_CONFIG.consensus;

// ── Hook toggles ─────────────────────────────────────────
const _hooksEnabled = plugin.hooks_enabled ?? {};
/** 훅 활성화 여부 확인. config에 없으면 기본값 true. */
export function isHookEnabled(hookName) {
  return _hooksEnabled[hookName] ?? true;
}

// ── Locale 검증 (path traversal 방지) ─────────────────────
const ALLOWED_LOCALES = new Set(["en", "ko"]);
const rawLocale = plugin.locale ?? "en";
export const safeLocale = ALLOWED_LOCALES.has(rawLocale) ? rawLocale : "en";

// ── Section name constants (English defaults; config overrides) ──
const S = consensus.sections ?? {};
export const SEC = {
  auditScope:         S.audit_scope         ?? "Audit Scope",
  finalVerdict:       S.final_verdict       ?? "Final Verdict",
  agreedAnchor:       S.agreed_anchor       ?? "Agreed",
  resetCriteria:      S.reset_criteria      ?? "Reset Criteria",
  rejectCodes:        S.reject_codes        ?? "Reject Codes",
  additionalTasks:    S.additional_tasks    ?? "Additional Tasks",
  nextTask:           S.next_task           ?? "Next Task",
  deprecatedProtocol: S.deprecated_protocol ?? "Improved Protocol",
  promotionTarget:    S.promotion_target    ?? "Current Promotion Target",
  changedFiles:       S.changed_files       ?? "Changed Files",
};

export const DOC_PATTERNS = consensus.doc_patterns ?? {};

// ── Tag constants + regex ─────────────────────────────────
export const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const triggerInner = consensus.trigger_tag.replace(/^\[|\]$/g, "");
export const agreeInner   = consensus.agree_tag.replace(/^\[|\]$/g, "");
export const pendingInner = consensus.pending_tag.replace(/^\[|\]$/g, "");

const tagAlts = [agreeInner, pendingInner, triggerInner].map(escapeRe).join("|");

export const STATUS_TAG_RE = new RegExp(`\\[(${tagAlts})(?:[^\\]]*?)\\]`);
export const STATUS_TAG_RE_GLOBAL = new RegExp(
  "`?\\[(" + tagAlts + ")(?:[^\\]]*?)\\]`?", "g",
);

// ── Path resolution (memoized) ────────────────────────────
let _watchPath = undefined;
let _respondPath = undefined;

function probeFile(subPath, name) {
  const dirs = [resolve(HOOKS_DIR, subPath), resolve(REPO_ROOT, subPath)];
  for (const dir of dirs) {
    for (const v of [name, name.toUpperCase(), name.toLowerCase()]) {
      const p = resolve(dir, v);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

export function findWatchFile() {
  if (_watchPath !== undefined && _watchPath !== null) return _watchPath;
  const name    = consensus.watch_file.split("/").pop();
  const subPath = consensus.watch_file.split("/").slice(0, -1).join("/");
  _watchPath = probeFile(subPath, name);
  return _watchPath;
}

export function findRespondFile() {
  if (_respondPath !== undefined && _respondPath !== null) return _respondPath;
  const respondName = plugin.respond_file ?? "gpt.md";
  const subPath = consensus.watch_file.split("/").slice(0, -1).join("/");
  _respondPath = probeFile(subPath, respondName);
  return _respondPath;
}

/** Reset memoization cache — for testing. */
export function resetPathCache() {
  _watchPath = undefined;
  _respondPath = undefined;
}

// ── i18n (cached) ─────────────────────────────────────────
const localeCache = new Map();

/** Resolve locales directory — prefer CLAUDE_PLUGIN_ROOT so worktree copies can find locale files. */
function findLocalesDir() {
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (pluginRoot) {
    const p = resolve(pluginRoot, "locales");
    if (existsSync(p)) return p;
  }
  return resolve(HOOKS_DIR, "locales");
}

export function createT(locale) {
  if (localeCache.has(locale)) return localeCache.get(locale);

  const localePath = resolve(findLocalesDir(), `${locale}.json`);
  let messages = {};
  try { messages = JSON.parse(readFileSync(localePath, "utf8")); } catch { /* fallback */ }

  const t = (key, vars) => {
    let msg = messages[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        msg = msg.split(`{${k}}`).join(String(v));
      }
    }
    return msg;
  };

  localeCache.set(locale, t);
  return t;
}

export const t = createT(safeLocale);

// ── Markdown parser ───────────────────────────────────────

/** Extract status tag from a line. When multiple tags exist, the last (newest) wins. */
export function extractStatusFromLine(line) {
  const match = line.match(STATUS_TAG_RE);
  if (!match) return null;

  const innerRe = new RegExp(tagAlts, "g");
  const statuses = [...match[0].matchAll(innerRe)].map((item) => item[0]);
  return statuses.at(-1) ?? null;
}

/** Find a `## heading` section in markdown and return { start, end, lines }. */
export function readSection(markdown, heading) {
  const lines = typeof markdown === "string" ? markdown.split(/\r?\n/) : markdown;
  const start = lines.findIndex((line) =>
    new RegExp(`^##\\s+${heading}\\s*$`).test((typeof line === "string" ? line : "").trim())
  );
  if (start < 0) return null;
  const end = lines.findIndex((line, idx) =>
    idx > start && /^##\s+/.test((typeof line === "string" ? line : "").trim())
  );
  return {
    start,
    end: end >= 0 ? end : lines.length,
    lines: lines.slice(start, end >= 0 ? end : lines.length),
  };
}

/** Replace a section. Appends to end of file if section not found. */
export function replaceSection(markdown, heading, replacementLines) {
  const lines = markdown.split(/\r?\n/);
  const section = readSection(lines, heading);
  if (section) {
    lines.splice(section.start, section.end - section.start, ...replacementLines);
    return `${lines.join("\n")}\n`;
  }
  return `${markdown.replace(/\s*$/, "")}\n\n${replacementLines.join("\n")}\n`;
}

/** Remove a section. */
export function removeSection(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const section = readSection(lines, heading);
  if (!section) return markdown;
  lines.splice(section.start, section.end - section.start);
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s*$/, "")}\n`;
}

/** Parse all lines containing status tags. */
export function parseStatusLines(markdown) {
  const items = [];
  for (const line of markdown.split(/\r?\n/)) {
    const status = extractStatusFromLine(line);
    if (!status) continue;
    const key = line
      .replace(STATUS_TAG_RE_GLOBAL, "")
      .replace(/\*\*/g, "")
      .replace(/`/g, "")
      .replace(/^[\s-]*/, "")
      .replace(/:\s*$/, "")
      .trim();
    items.push({ status, key, raw: line.trim() });
  }
  return items;
}

export function stripStatusFormatting(line) {
  return line
    .replace(STATUS_TAG_RE_GLOBAL, "")
    .replace(/^[\s#-]*/, "")
    .replace(/`/g, "")
    .replace(/\*\*/g, "")
    .replace(/:\s*$/, "")
    .trim();
}

export function replaceStatusTag(line, status) {
  return line.replace(STATUS_TAG_RE, `[${status}]`);
}

/** Extract IDs (e.g. TN-1, FE-6A, E1) from a line. Supports ranges (TN-1~TN-6). */
export function collectIdsFromLine(line) {
  const ids = new Set();

  const rangeRe = /\b([A-Z]{2,})-(\d+)([A-Z]?)\s*~\s*(?:\1-?)?(\d+)([A-Z]?)\b/g;
  let m;
  while ((m = rangeRe.exec(line)) !== null) {
    const [, prefix, startStr, startSuffix, endStr, endSuffix] = m;
    const start = Number(startStr), end = Number(endStr);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start && startSuffix === endSuffix) {
      for (let i = start; i <= end; i++) ids.add(`${prefix}-${i}${startSuffix}`);
    }
  }

  const idRe = /\b([A-Z]{2,})-(\d+)([A-Z]?)\b/g;
  while ((m = idRe.exec(line)) !== null) ids.add(`${m[1]}-${m[2]}${m[3] ?? ""}`);

  const singleRe = /\b([A-Z])(\d{1,2})\b/g;
  while ((m = singleRe.exec(line)) !== null) {
    const id = `${m[1]}${m[2]}`;
    if (!/^H[1-6]$/.test(id)) ids.add(id);
  }

  return [...ids];
}

/** Extract `- ` bullet items from a section. */
export function readBulletSection(markdown, heading) {
  const section = readSection(markdown, heading);
  if (!section) return [];
  return section.lines
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.replace(/^- /, "").trim());
}

/** Check for empty markers (해당 없음, 없음, none). */
export function isEmptyMarker(line) {
  return new RegExp(
    `^\`?(${DOC_PATTERNS.empty_markers ?? "해당 없음|없음|none"})\`?$`, "i"
  ).test(line.trim());
}

/** Extract approved IDs from markdown. */
export function extractApprovedIds(markdown) {
  const ids = new Set();
  for (const line of markdown.split(/\r?\n/)) {
    if (extractStatusFromLine(line) !== agreeInner) continue;
    for (const id of collectIdsFromLine(line)) ids.add(id);
  }
  return ids;
}

/** Extract pending IDs from markdown. */
export function extractPendingIds(markdown) {
  const ids = new Set();
  for (const line of markdown.split(/\r?\n/)) {
    if (extractStatusFromLine(line) !== pendingInner) continue;
    for (const id of collectIdsFromLine(line)) ids.add(id);
  }
  return ids;
}

/** Extract approved IDs from a specific section. */
export function extractApprovedIdsFromSection(markdown, heading) {
  const section = readSection(markdown, heading);
  return section ? extractApprovedIds(section.lines.join("\n")) : new Set();
}

export function mergeIdSets(...sets) {
  const merged = new Set();
  for (const s of sets) for (const v of s) merged.add(v);
  return merged;
}
