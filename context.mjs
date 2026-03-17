#!/usr/bin/env node
/**
 * 공유 컨텍스트 모듈 — config, 경로, 태그 상수, 마크다운 파서, i18n 캐시.
 *
 * 모든 consensus-loop 스크립트는 이 모듈에서 import하여
 * config.json 중복 파싱, 경로 중복 해석, 함수 중복 구현을 제거한다.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── 경로 ──────────────────────────────────────────────────
export const HOOKS_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HOOKS_DIR, "..", "..", "..");

// ── config ────────────────────────────────────────────────
export const cfg = JSON.parse(readFileSync(resolve(HOOKS_DIR, "config.json"), "utf8"));
export const plugin = cfg.plugin;
export const consensus = cfg.consensus;

// ── 섹션 이름 상수 ────────────────────────────────────────
const S = consensus.sections ?? {};
export const SEC = {
  auditScope:         S.audit_scope         ?? "감사 범위",
  finalVerdict:       S.final_verdict       ?? "최종 판정",
  agreedAnchor:       S.agreed_anchor       ?? "합의완료",
  resetCriteria:      S.reset_criteria      ?? "완료 기준 재고정",
  rejectCodes:        S.reject_codes        ?? "반려 코드",
  additionalTasks:    S.additional_tasks    ?? "추가 작업",
  nextTask:           S.next_task           ?? "다음 작업",
  deprecatedProtocol: S.deprecated_protocol ?? "개선된 프로토콜",
  promotionTarget:    S.promotion_target    ?? "현재 승격 대상",
  changedFiles:       S.changed_files       ?? "변경 파일",
};

export const DOC_PATTERNS = consensus.doc_patterns ?? {};

// ── 태그 상수 + 정규식 ───────────────────────────────────
export const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const triggerInner = consensus.trigger_tag.replace(/^\[|\]$/g, "");
export const agreeInner   = consensus.agree_tag.replace(/^\[|\]$/g, "");
export const pendingInner = consensus.pending_tag.replace(/^\[|\]$/g, "");

const tagAlts = [agreeInner, pendingInner, triggerInner].map(escapeRe).join("|");

export const STATUS_TAG_RE = new RegExp(`\\[(${tagAlts})(?:[^\\]]*?)\\]`);
export const STATUS_TAG_RE_GLOBAL = new RegExp(
  "`?\\[(" + tagAlts + ")(?:[^\\]]*?)\\]`?", "g",
);

// ── 경로 해석 (메모이제이션) ─────────────────────────────
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

/** 메모이제이션 캐시 초기화 — 테스트용 */
export function resetPathCache() {
  _watchPath = undefined;
  _respondPath = undefined;
}

// ── i18n (캐시) ──────────────────────────────────────────
const localeCache = new Map();

export function createT(locale) {
  if (localeCache.has(locale)) return localeCache.get(locale);

  const localePath = resolve(HOOKS_DIR, "locales", `${locale}.json`);
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

export const t = createT(plugin.locale ?? "en");

// ── 마크다운 파서 ────────────────────────────────────────

/** 라인에서 상태 태그를 추출. 여러 태그가 있으면 마지막(최신)이 우선. */
export function extractStatusFromLine(line) {
  const match = line.match(STATUS_TAG_RE);
  if (!match) return null;

  const innerRe = new RegExp(tagAlts, "g");
  const statuses = [...match[0].matchAll(innerRe)].map((item) => item[0]);
  return statuses.at(-1) ?? null;
}

/** 마크다운에서 `## heading` 섹션을 찾아 { start, end, lines }를 반환. */
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

/** 섹션을 교체. 섹션이 없으면 파일 끝에 추가. */
export function replaceSection(markdown, heading, replacementLines) {
  const lines = markdown.split(/\r?\n/);
  const section = readSection(lines, heading);
  if (section) {
    lines.splice(section.start, section.end - section.start, ...replacementLines);
    return `${lines.join("\n")}\n`;
  }
  return `${markdown.replace(/\s*$/, "")}\n\n${replacementLines.join("\n")}\n`;
}

/** 섹션을 제거. */
export function removeSection(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const section = readSection(lines, heading);
  if (!section) return markdown;
  lines.splice(section.start, section.end - section.start);
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s*$/, "")}\n`;
}

/** 상태 태그가 있는 모든 라인을 파싱. */
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

/** 라인에서 ID(예: TN-1, FE-6A, E1)를 추출. 범위(TN-1~TN-6)도 지원. */
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

/** 불릿 섹션에서 `- ` 항목만 추출. */
export function readBulletSection(markdown, heading) {
  const section = readSection(markdown, heading);
  if (!section) return [];
  return section.lines
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.replace(/^- /, "").trim());
}

/** 빈 마커 (해당 없음, 없음, none) 판별. */
export function isEmptyMarker(line) {
  return new RegExp(
    `^\`?(${DOC_PATTERNS.empty_markers ?? "해당 없음|없음|none"})\`?$`, "i"
  ).test(line.trim());
}

/** 마크다운에서 합의완료 ID를 추출. */
export function extractApprovedIds(markdown) {
  const ids = new Set();
  for (const line of markdown.split(/\r?\n/)) {
    if (extractStatusFromLine(line) !== agreeInner) continue;
    for (const id of collectIdsFromLine(line)) ids.add(id);
  }
  return ids;
}

/** 마크다운에서 계류 ID를 추출. */
export function extractPendingIds(markdown) {
  const ids = new Set();
  for (const line of markdown.split(/\r?\n/)) {
    if (extractStatusFromLine(line) !== pendingInner) continue;
    for (const id of collectIdsFromLine(line)) ids.add(id);
  }
  return ids;
}

/** 특정 섹션에서 합의완료 ID를 추출. */
export function extractApprovedIdsFromSection(markdown, heading) {
  const section = readSection(markdown, heading);
  return section ? extractApprovedIds(section.lines.join("\n")) : new Set();
}

export function mergeIdSets(...sets) {
  const merged = new Set();
  for (const s of sets) for (const v of s) merged.add(v);
  return merged;
}
