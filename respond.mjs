#!/usr/bin/env node
/* global process, console */

/**
 * GPT → Claude direction: auto-sync gpt.md verdicts into claude.md.
 *
 * agree_tag items: applied via direct file write.
 * pending_tag items: corrections extracted and forwarded to claude -p.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBinary, spawnResolved } from "./cli-runner.mjs";
import { createT } from "./i18n.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");
const cfg = JSON.parse(readFileSync(resolve(__dirname, "config.json"), "utf8"));
const t = createT(cfg.plugin.locale ?? "en");

// Section heading constants pulled from config — protocol identifiers, not UI messages.
const S = cfg.consensus.sections ?? {};
const D = cfg.consensus.doc_patterns ?? {};
const SEC = {
  auditScope:         S.audit_scope         ?? "감사 범위",
  finalVerdict:       S.final_verdict       ?? "최종 판정",
  agreedAnchor:       S.agreed_anchor       ?? "합의완료",
  resetCriteria:      S.reset_criteria      ?? "완료 기준 재고정",
  rejectCodes:        S.reject_codes        ?? "반려 코드",
  additionalTasks:    S.additional_tasks    ?? "추가 작업",
  nextTask:           S.next_task           ?? "다음 작업",
  deprecatedProtocol: S.deprecated_protocol ?? "개선된 프로토콜",
  promotionTarget:    S.promotion_target    ?? "현재 승격 대상",
};
const triggerInner = cfg.consensus.trigger_tag.replace(/^\[|\]$/g, "");
const agreeInner   = cfg.consensus.agree_tag.replace(/^\[|\]$/g, "");
const pendingInner = cfg.consensus.pending_tag.replace(/^\[|\]$/g, "");
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const claudePathPlugin = resolve(__dirname, cfg.consensus.watch_file);
const claudePathRepo   = resolve(repoRoot, cfg.consensus.watch_file);
const claudePath = existsSync(claudePathPlugin) ? claudePathPlugin : claudePathRepo;
const respondFile      = cfg.plugin.respond_file ?? "gpt.md";
const gptPath          = resolve(dirname(claudePath), respondFile);
const planningDirs     = (cfg.consensus.planning_dirs ?? []).map((d) => resolve(repoRoot, d.replace(/^\/+/, "")));
const watchFileDisplay = cfg.consensus.watch_file;
const gptFileDisplay   = `${dirname(cfg.consensus.watch_file)}/${respondFile}`;
const STATUS_TAG_RE = new RegExp(
  `\\[(${[agreeInner, pendingInner, triggerInner].map(escapeRe).join("|")})(?:[^\\]]*?)\\]`,
);
const STATUS_TAG_RE_GLOBAL = new RegExp(
  "`?\\[(" + [agreeInner, pendingInner, triggerInner].map(escapeRe).join("|") + ")(?:[^\\]]*?)\\]`?",
  "g",
);

function usage() {
  console.log(`Usage: node .claude/hooks/consensus-loop/respond.mjs [options]

Options:
  --auto-fix         Invoke claude -p for ${cfg.consensus.pending_tag} corrections
  --gpt-only         Normalize only gpt.md / promotion docs and skip claude.md sync
  --no-sync-next     Do not normalize the "## ${SEC.nextTask}" section in gpt.md
  --dry-run          Show changes without writing
  -h, --help         Show this help
`);
}

function parseArgs(argv) {
  const args = { autoFix: false, dryRun: false, syncNext: true, gptOnly: false };
  for (const arg of argv) {
    if (arg === "--auto-fix") args.autoFix = true;
    else if (arg === "--gpt-only") args.gptOnly = true;
    else if (arg === "--no-sync-next") args.syncNext = false;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "-h" || arg === "--help") { usage(); process.exit(0); }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function extractStatusFromLine(line) {
  const match = line.match(STATUS_TAG_RE);
  if (!match) {
    return null;
  }

  const innerRe = new RegExp([agreeInner, pendingInner, triggerInner].map(escapeRe).join("|"), "g");
  const statuses = [...match[0].matchAll(innerRe)].map((item) => item[0]);
  // Last tag wins — a line may carry both trigger and agree tags simultaneously;
  // the rightmost (most recent) state takes precedence.
  return statuses.at(-1) ?? null;
}

/** Extract all lines carrying a status tag from audit scope and final verdict sections. */
function parseStatusLines(markdown) {
  const items = [];
  for (const line of markdown.split(/\r?\n/)) {
    const status = extractStatusFromLine(line);
    if (!status) continue;
    // Item text with status tags stripped — used as a comparison key
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

function stripStatusFormatting(line) {
  return line
    .replace(STATUS_TAG_RE_GLOBAL, "")
    .replace(/^[\s#-]*/, "")
    .replace(/`/g, "")
    .replace(/\*\*/g, "")
    .replace(/:\s*$/, "")
    .trim();
}

/** Apply agree_tag verdicts from gpt.md to claude.md. */
function syncApproved(claudeMd, gptMd) {
  let updated = claudeMd;
  const synced = [];

  const auditSection = readSection(gptMd, SEC.auditScope);
  const approvedScopeLines = (auditSection?.lines ?? [])
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- ") && extractStatusFromLine(line) === agreeInner);

  for (const scopeLine of approvedScopeLines) {
    const ids = collectIdsFromLine(scopeLine);
    if (ids.length === 0) {
      continue;
    }

    const label = stripStatusFormatting(scopeLine);
    const lines = updated.split(/\r?\n/);
    let localChange = false;

    for (let i = 0; i < lines.length; i++) {
      if (extractStatusFromLine(lines[i]) !== triggerInner) {
        continue;
      }
      const lineIds = collectIdsFromLine(lines[i]);
      if (lineIds.length === 0) {
        continue;
      }
      const sameItem = ids.every((id) => lineIds.includes(id));
      if (sameItem) {
        lines[i] = replaceStatusTag(lines[i], agreeInner);
        localChange = true;
      }
    }

    const anchorSection = readSection(lines.join("\n"), SEC.agreedAnchor);
    if (anchorSection) {
      const hasAnchor = anchorSection.lines.some((line) => {
        const lineIds = collectIdsFromLine(line);
        return ids.every((id) => lineIds.includes(id));
      });
      if (!hasAnchor) {
        let insertAt = anchorSection.end;
        while (insertAt > anchorSection.start && lines[insertAt - 1]?.trim() === "") {
          insertAt -= 1;
        }
        lines.splice(insertAt, 0, `- \`${cfg.consensus.agree_tag}\` ${label}`);
        localChange = true;
      }
    }

    if (localChange) {
      updated = `${lines.join("\n")}\n`;
      synced.push(label);
    }
  }

  return { updated, synced };
}

/** Extract correction requests from pending_tag items. */
function extractCorrections(gptMd) {
  const verdictSection = readSection(gptMd, SEC.finalVerdict);
  const source = verdictSection ? verdictSection.lines.join("\n") : gptMd;
  const pending = parseStatusLines(source).filter((i) => i.status === pendingInner);
  if (pending.length === 0) return [];
  return [...new Set(pending.map((p) => p.key))];
}

function readSection(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^##\\s+${heading}\\s*$`).test(line.trim()));
  if (start < 0) {
    return null;
  }
  const end = lines.findIndex((line, idx) => idx > start && /^##\s+/.test(line.trim()));
  return {
    start,
    end: end >= 0 ? end : lines.length,
    lines: lines.slice(start, end >= 0 ? end : lines.length),
  };
}

function readBulletSection(markdown, heading) {
  const section = readSection(markdown, heading);
  if (!section) {
    return [];
  }
  return section.lines
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.replace(/^- /, "").trim());
}

function isEmptyMarker(line) {
  return new RegExp(`^\`?(${D.empty_markers ?? "해당 없음|없음|none"})\`?$`, "i").test(line.trim());
}

function replaceSection(markdown, heading, replacementLines) {
  const lines = markdown.split(/\r?\n/);
  const section = readSection(markdown, heading);
  const replacement = [...replacementLines];

  if (section) {
    lines.splice(section.start, section.end - section.start, ...replacement);
    return `${lines.join("\n")}\n`;
  }

  const trimmed = markdown.replace(/\s*$/, "");
  return `${trimmed}\n\n${replacement.join("\n")}\n`;
}

function removeSection(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const section = readSection(markdown, heading);
  if (!section) {
    return markdown;
  }
  lines.splice(section.start, section.end - section.start);
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s*$/, "")}\n`;
}

function replaceStatusTag(line, status) {
  return line.replace(STATUS_TAG_RE, `[${status}]`);
}

function extractApprovedIdsFromSection(markdown, heading) {
  const section = readSection(markdown, heading);
  return section ? extractApprovedIds(section.lines.join("\n")) : new Set();
}

function mergeIdSets(...sets) {
  const merged = new Set();
  for (const set of sets) {
    for (const value of set) {
      merged.add(value);
    }
  }
  return merged;
}

function normalizeGptAuditScopeStatus(gptMd) {
  const auditSection = readSection(gptMd, SEC.auditScope);
  if (!auditSection) {
    return { updated: gptMd, changed: false };
  }

  const verdictApprovedIds = extractApprovedIdsFromSection(gptMd, SEC.finalVerdict);
  if (verdictApprovedIds.size === 0) {
    return { updated: gptMd, changed: false };
  }

  const replacementLines = auditSection.lines.map((line, index) => {
    if (index === 0) {
      return line;
    }
    const status = extractStatusFromLine(line);
    if (!status) {
      return line;
    }
    const ids = collectIdsFromLine(line);
    if (ids.length === 0) {
      return line;
    }
    const isClosed = ids.every((id) => verdictApprovedIds.has(id));
    if (isClosed && !line.includes(cfg.consensus.agree_tag)) {
      return replaceStatusTag(line, agreeInner);
    }
    return line;
  });

  const updated = replaceSection(gptMd, SEC.auditScope, replacementLines);
  return { updated, changed: updated !== gptMd };
}

function normalizeResetCriteriaSection(gptMd) {
  const verdictSection = readSection(gptMd, SEC.finalVerdict);
  const verdictItems = verdictSection ? parseStatusLines(verdictSection.lines.join("\n")) : [];
  const hasPending = verdictItems.some((item) => item.status === pendingInner);
  const currentCriteria = readBulletSection(gptMd, SEC.resetCriteria);
  const hasMeaningfulCriteria = currentCriteria.some((line) => !isEmptyMarker(line));

  if (!hasPending || hasMeaningfulCriteria) {
    return { updated: gptMd, changed: false };
  }

  const rejectCodes = readBulletSection(gptMd, SEC.rejectCodes).filter((line) => !isEmptyMarker(line));
  const pendingLabels = verdictItems
    .filter((item) => item.status === pendingInner)
    .map((item) => stripStatusFormatting(item.raw)
      .replace(new RegExp(D.completion_suffix ?? ":\\s*완료\\s*\\/?"), "").trim());

  const focus = rejectCodes.length > 0
    ? rejectCodes.join(", ")
    : pendingLabels.join(", ") || (D.pending_focus_fallback ?? "현재 계류 항목");

  const criteriaText = (D.reset_criteria_text ?? "현재 범위는 `{focus}` 보정과 관련 lint/테스트 재통과가 확인되어야 `{agree_tag}`로 승격한다.")
    .split("{focus}").join(focus)
    .split("{agree_tag}").join(cfg.consensus.agree_tag);

  const updated = replaceSection(gptMd, SEC.resetCriteria, [
    `## ${SEC.resetCriteria}`,
    "",
    `- ${criteriaText}`,
  ]);

  return { updated, changed: updated !== gptMd };
}

function findNextAuditTaskInClaude(claudeMd, approvedIds = new Set()) {
  const auditSection = readSection(claudeMd, SEC.auditScope);
  const lines = auditSection ? auditSection.lines : claudeMd.split(/\r?\n/);

  for (const line of lines) {
    const status = extractStatusFromLine(line);
    if (status !== triggerInner && status !== pendingInner) {
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed.startsWith("- ")) {
      continue;
    }
    const ids = collectIdsFromLine(line);
    if (ids.length > 0 && ids.every((id) => approvedIds.has(id))) {
      continue;
    }
    return trimmed.replace(/^- /, "").trim();
  }

  return null;
}

function findPendingVerdictTaskInGpt(gptMd) {
  const verdictSection = readSection(gptMd, SEC.finalVerdict);
  if (!verdictSection) {
    return null;
  }

  for (const line of verdictSection.lines) {
    if (extractStatusFromLine(line) !== pendingInner) {
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed.startsWith("- ")) {
      continue;
    }
    return stripStatusFormatting(trimmed.replace(/^- /, "").trim());
  }

  return null;
}

function findAdditionalTaskInGpt(gptMd) {
  const section = readSection(gptMd, SEC.additionalTasks);
  if (!section) {
    return null;
  }

  for (const line of section.lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("- ")) {
      continue;
    }
    const value = trimmed.replace(/^- /, "").trim();
    if (isEmptyMarker(value)) {
      continue;
    }
    return value;
  }

  return null;
}

function normalizeAdditionalTasksSection(gptMd) {
  const section = readSection(gptMd, SEC.additionalTasks);
  if (!section) {
    return { updated: gptMd, changed: false };
  }

  const approvedIds = extractApprovedIdsFromSection(gptMd, SEC.finalVerdict);
  if (approvedIds.size === 0) {
    return { updated: gptMd, changed: false };
  }

  const keptLines = [section.lines[0]];
  for (const line of section.lines.slice(1)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("- ")) {
      keptLines.push(line);
      continue;
    }

    const ids = collectIdsFromLine(line);
    if (ids.length > 0 && ids.every((id) => approvedIds.has(id))) {
      continue;
    }

    keptLines.push(line);
  }

  const hasTask = keptLines.some((line, index) => {
    if (index === 0) return false;
    const trimmed = line.trim();
    return trimmed.startsWith("- ") && !isEmptyMarker(trimmed.replace(/^- /, "").trim());
  });

  const updated = hasTask
    ? replaceSection(gptMd, SEC.additionalTasks, keptLines)
    : removeSection(gptMd, SEC.additionalTasks);

  return { updated, changed: updated !== gptMd };
}

function syncGptNextTaskWithPromotion(gptMd, claudeMd, state) {
  const verdictSection = readSection(gptMd, SEC.finalVerdict);
  const verdictItems = verdictSection ? parseStatusLines(verdictSection.lines.join("\n")) : [];
  if (verdictItems.length === 0) {
    return { updated: gptMd, changed: false };
  }

  const additionalTask = findAdditionalTaskInGpt(gptMd);
  if (additionalTask) {
    const updated = replaceSection(gptMd, SEC.nextTask, [
      `## ${SEC.nextTask}`,
      "",
      `- ${additionalTask}`,
    ]);
    return { updated, changed: updated !== gptMd };
  }

  const pendingVerdictTask = findPendingVerdictTaskInGpt(gptMd);
  if (pendingVerdictTask) {
    const updated = replaceSection(gptMd, SEC.nextTask, [
      `## ${SEC.nextTask}`,
      "",
      `- \`${pendingVerdictTask}\``,
    ]);
    return { updated, changed: updated !== gptMd };
  }

  if (verdictItems.some((item) => item.status !== agreeInner)) {
    return { updated: gptMd, changed: false };
  }

  const approvedIds = resolvePromotionApprovedIds(claudeMd, gptMd);
  const activeAuditTask = findNextAuditTaskInClaude(claudeMd, approvedIds);
  const nextTask =
    state?.nextStage?.next_task_ko ??
    state?.nextStage?.next_task_en ??
    activeAuditTask ??
    `\`${D.no_next_task ?? t("pdoc.no_next_task")}\``;

  if (!nextTask) {
    return { updated: gptMd, changed: false };
  }

  const updated = replaceSection(gptMd, SEC.nextTask, [
    `## ${SEC.nextTask}`,
    "",
    `- ${nextTask}`,
  ]);

  return { updated, changed: updated !== gptMd };
}

function collectIdsFromLine(line) {
  const ids = new Set();
  const rangeRe = /\b([A-Z]{2,})-(\d+)([A-Z]?)\s*~\s*(?:\1-?)?(\d+)([A-Z]?)\b/g;
  let rangeMatch;
  while ((rangeMatch = rangeRe.exec(line)) !== null) {
    const prefix = rangeMatch[1];
    const start = Number(rangeMatch[2]);
    const startSuffix = rangeMatch[3] ?? "";
    const end = Number(rangeMatch[4]);
    const endSuffix = rangeMatch[5] ?? "";
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start && startSuffix === endSuffix) {
      for (let i = start; i <= end; i++) {
        ids.add(`${prefix}-${i}${startSuffix}`);
      }
    }
  }

  const idRe = /\b([A-Z]{2,})-(\d+)([A-Z]?)\b/g;
  let idMatch;
  while ((idMatch = idRe.exec(line)) !== null) {
    ids.add(`${idMatch[1]}-${idMatch[2]}${idMatch[3] ?? ""}`);
  }

  // Single-char prefix IDs: E1, E2, F3, G1 etc. (no dash, digit directly follows)
  // Exclude H1-H6 to avoid false positives with markdown headings.
  const singleRe = /\b([A-Z])(\d{1,2})\b/g;
  let singleMatch;
  while ((singleMatch = singleRe.exec(line)) !== null) {
    const id = `${singleMatch[1]}${singleMatch[2]}`;
    if (/^H[1-6]$/.test(id)) continue;
    ids.add(id);
  }

  return [...ids];
}

function extractApprovedIds(markdown) {
  const ids = new Set();
  for (const line of markdown.split(/\r?\n/)) {
    if (extractStatusFromLine(line) !== agreeInner) {
      continue;
    }
    for (const id of collectIdsFromLine(line)) {
      ids.add(id);
    }
  }
  return ids;
}

function extractPendingIds(markdown) {
  const ids = new Set();
  for (const line of markdown.split(/\r?\n/)) {
    if (extractStatusFromLine(line) !== pendingInner) {
      continue;
    }
    for (const id of collectIdsFromLine(line)) {
      ids.add(id);
    }
  }
  return ids;
}

function resolvePromotionApprovedIds(claudeMd, gptMd) {
  const approved = mergeIdSets(
    extractApprovedIdsFromSection(claudeMd, SEC.agreedAnchor),
    extractApprovedIdsFromSection(gptMd, SEC.finalVerdict),
  );
  const downgraded = extractPendingIds(readSection(gptMd, SEC.finalVerdict)?.lines.join("\n") ?? "");
  for (const id of downgraded) {
    approved.delete(id);
  }
  return approved;
}

function detectLocale(dir) {
  const normalized = dir.replace(/\\/g, "/");
  return /\/en(\/|$)/.test(normalized) ? "en" : "ko";
}

function loadPromotionPlan() {
  for (const dir of planningDirs) {
    const p = resolve(dir, "feedback-promotion.plan.json");
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  }
  return null;
}

function extractImprovedOrderSlugs(markdown) {
  const seen = new Set();
  const slugs = [];
  const re = /\]\(\.\/([a-z0-9-]+)\/README\.md\)/gi;
  let match;
  while ((match = re.exec(markdown)) !== null) {
    const slug = match[1];
    if (slug === "feedback-promotion") continue;
    if (seen.has(slug)) continue;
    seen.add(slug);
    slugs.push(slug);
  }
  return slugs;
}

function extractDocTitle(markdown) {
  const firstHeading = markdown.split(/\r?\n/).find((line) => /^#\s+/.test(line.trim()));
  if (!firstHeading) return null;
  return firstHeading
    .replace(/^#\s+/, "")
    .replace(new RegExp(`^(${D.design_prefix ?? "설계|Design"}):\\s*`, "i"), "")
    .trim();
}

function extractOrderedIds(workBreakdownMd) {
  const lines = workBreakdownMd.split(/\r?\n/);
  const ordered = [];
  const seen = new Set();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!/^\d+\.\s+/.test(trimmed)) continue;
    for (const id of collectIdsFromLine(trimmed)) {
      if (seen.has(id)) continue;
      seen.add(id);
      ordered.push(id);
    }
  }

  if (ordered.length > 0) {
    return ordered;
  }

  for (const line of lines) {
    const match = line.match(/^##\s+([A-Z]{1,4}-\d+[A-Z]?)\b/);
    if (!match) continue;
    const id = match[1];
    if (seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }

  return ordered;
}

function extractIdTitleMap(workBreakdownMd) {
  const map = new Map();
  for (const line of workBreakdownMd.split(/\r?\n/)) {
    const match = line.match(/^##\s+([A-Z]{1,4}-\d+[A-Z]?)\s+(.+?)\s*$/);
    if (!match) continue;
    map.set(match[1], match[2].trim());
  }
  return map;
}

function buildAutoNextTask(title, ids, titleMap, locale) {
  const tDoc = createT(locale);
  const labels = ids.map((id) => titleMap.get(id) ?? id);
  const idText = ids.join(" + ");
  const actionText = labels.length > 1
    ? tDoc("pdoc.close_tasks", { head: labels.slice(0, -1).join(", "), last: labels.at(-1) })
    : tDoc("pdoc.close_task", { label: labels[0] });
  return `\`${title} / ${idText} — ${actionText}\``;
}

function extractStageSlug(stage) {
  const ref = stage?.source_docs_ko?.[0] ?? stage?.source_docs_en?.[0] ?? "";
  const match = String(ref).match(/^\.\/([^/]+)\//);
  return match ? match[1] : null;
}

function deriveAutoPromotionStage(plan, approvedIds) {
  for (const planningDir of planningDirs) {
    const execOrderPath = resolve(planningDir, "execution-order.md");
    if (!existsSync(execOrderPath)) continue;

    const orderMd = readFileSync(execOrderPath, "utf8");
    const orderedSlugs = extractImprovedOrderSlugs(orderMd);
    const lastPlannedSlug = plan?.stages?.length ? extractStageSlug(plan.stages.at(-1)) : null;
    const startIndex = lastPlannedSlug ? orderedSlugs.indexOf(lastPlannedSlug) + 1 : 0;
    const candidateSlugs = startIndex > 0 ? orderedSlugs.slice(startIndex) : orderedSlugs;

    for (const slug of candidateSlugs) {
      const readmePath = resolve(planningDir, slug, "README.md");
      const wbsPath    = resolve(planningDir, slug, "work-breakdown.md");
      if (!existsSync(wbsPath)) continue;

      const wbsMd      = readFileSync(wbsPath, "utf8");
      const orderedIds = extractOrderedIds(wbsMd);
      if (orderedIds.length === 0) continue;

      const remainingIds = orderedIds.filter((id) => !approvedIds.has(id));
      if (remainingIds.length === 0) continue;

      const nextIds  = remainingIds.slice(0, Math.min(2, remainingIds.length));
      const titleMap = extractIdTitleMap(wbsMd);
      const locale   = detectLocale(planningDir);
      const title    = existsSync(readmePath)
        ? (extractDocTitle(readFileSync(readmePath, "utf8")) ?? slug)
        : slug;
      const nextTask = buildAutoNextTask(title, nextIds, titleMap, locale);

      return {
        id: `auto:${slug}`,
        agree_ids: nextIds,
        agreed_label_ko: `\`${title} (${nextIds.join(" + ")})\``,
        agreed_label_en: `\`${title} (${nextIds.join(" + ")})\``,
        next_task_ko: nextTask,
        next_task_en: nextTask,
        source_docs_ko: [`./${slug}/README.md`, `./${slug}/work-breakdown.md`],
        source_docs_en: [`./${slug}/README.md`, `./${slug}/work-breakdown.md`],
      };
    }
  }

  return null;
}

function computePromotionState(plan, approvedIds) {
  const agreedStages = [];
  let nextStage = null;

  for (const stage of plan.stages ?? []) {
    const requiredIds = Array.isArray(stage.agree_ids) ? stage.agree_ids : [];
    const complete = requiredIds.length > 0 && requiredIds.every((id) => approvedIds.has(id));
    if (complete && nextStage === null) {
      agreedStages.push(stage);
      continue;
    }
    if (nextStage === null) {
      nextStage = stage;
    }
  }

  if (nextStage === null) {
    nextStage = deriveAutoPromotionStage(plan, approvedIds);
  }

  return { agreedStages, nextStage };
}

function renderPromotionDoc(locale, state) {
  const isKo = locale === "ko";
  const tDoc = createT(locale);
  const title = isKo ? "# 피드백 승격 인덱스" : "# Feedback Promotion Index";
  const meta = isKo
    ? "> 상태: `active` | 유형: 피드백 루프 승격 기준 | 생성: `.claude/hooks/consensus-loop/respond.mjs`"
    : "> Status: `active` | Type: feedback-loop promotion rule | Generated by: `.claude/hooks/consensus-loop/respond.mjs`";
  const feedbackDirGlob = `${dirname(watchFileDisplay)}/*.md`;
  const purpose = isKo
    ? [
        "## 목적",
        "",
        `\`${feedbackDirGlob}\`의 현재 감사 트랙이 완전히 \`${cfg.consensus.agree_tag}\`로 닫히면,`,
        "다음 작업은 임의로 쓰지 않고 이 문서에서 자동 승격한다.",
        "",
        `이 문서는 \`feedback-promotion.plan.json\`, 현재 \`${gptFileDisplay}\` 판정,`,
        `그리고 \`${watchFileDisplay}\`의 \`## ${SEC.agreedAnchor}\` 앵커를 바탕으로`,
        "**자동 생성**된다.",
      ]
    : [
        "## Purpose",
        "",
        `When the current audit track in \`${feedbackDirGlob}\` is fully closed as \`${cfg.consensus.agree_tag}\`,`,
        "the next work item is promoted automatically from this document instead of being written ad hoc.",
        "",
        `This document is **generated automatically** from \`feedback-promotion.plan.json\`,`,
        `the current verdicts in \`${gptFileDisplay}\`, and the \`## ${SEC.agreedAnchor}\` anchor`,
        `inside \`${watchFileDisplay}\`.`,
      ];
  const rule = isKo
    ? [
        "## 사용 규칙",
        "",
        `- 현재 감사 범위가 모두 \`${cfg.consensus.agree_tag}\`이면 \`${gptFileDisplay}\`의 \`## ${SEC.nextTask}\`은 이 문서의 \`## ${SEC.promotionTarget}\` 첫 항목을 사용한다.`,
        `- \`${feedbackDirGlob}\`에 남아 있는 별도 \`${cfg.consensus.pending_tag}\` 감사 항목은, 이미 합의된 트랙의 다음 improved 작업 승격을 자동으로 막지 않는다.`,
      ]
    : [
        "## Usage Rule",
        "",
        `- If the current audited scope is fully closed as \`${cfg.consensus.agree_tag}\`, \`${gptFileDisplay}\` should use the first item under \`## ${SEC.promotionTarget}\` as \`## ${SEC.nextTask}\`.`,
        `- Residual \`${cfg.consensus.pending_tag}\` audit items in \`${feedbackDirGlob}\` do not automatically block promotion of the next improved work item for an already agreed track.`,
      ];

  const agreedHeading = isKo ? "## 현재 합의된 트랙" : "## Currently Agreed Tracks";
  const agreedLines = state.agreedStages.length > 0
    ? state.agreedStages.map((stage) => `- ${isKo ? stage.agreed_label_ko : stage.agreed_label_en}`)
    : [tDoc("pdoc.none_item")];

  const targetHeading = isKo ? "## 현재 승격 대상" : "## Current Promotion Target";
  const targetLines = state.nextStage
    ? [`- ${isKo ? state.nextStage.next_task_ko : state.nextStage.next_task_en}`]
    : [tDoc("pdoc.no_promotion_target")];

  const sourceHeading = isKo ? "## 근거 문서" : "## Source Documents";
  const sourceDocs = state.nextStage
    ? (isKo ? state.nextStage.source_docs_ko : state.nextStage.source_docs_en) ?? []
    : [];
  const sourceLines = sourceDocs.length > 0
    ? sourceDocs.map((doc) => `- [${doc.replace(/^\.\//, "")}](${doc})`)
    : [tDoc("pdoc.none_item")];

  return [
    title,
    "",
    meta,
    "",
    ...purpose,
    "",
    ...rule,
    "",
    agreedHeading,
    "",
    ...agreedLines,
    "",
    targetHeading,
    "",
    ...targetLines,
    "",
    sourceHeading,
    "",
    ...sourceLines,
    "",
  ].join("\n");
}

function syncPromotionDocs(gptMd, args) {
  const plan = loadPromotionPlan();
  if (!plan) return [];

  const claudeMd    = existsSync(claudePath) ? readFileSync(claudePath, "utf8") : "";
  const approvedIds = resolvePromotionApprovedIds(claudeMd, gptMd);
  const state       = computePromotionState(plan, approvedIds);
  const outputs     = planningDirs.map((dir) => ({
    path: resolve(dir, "feedback-promotion.md"),
    content: renderPromotionDoc(detectLocale(dir), state),
  }));

  const changed = [];
  for (const output of outputs) {
    const current = existsSync(output.path) ? readFileSync(output.path, "utf8") : "";
    if (current === output.content) continue;
    changed.push(output.path);
    if (!args.dryRun) writeFileSync(output.path, output.content, "utf8");
  }

  return changed;
}

function syncDemotedAnchors(claudeMd, gptMd) {
  const section = readSection(claudeMd, SEC.agreedAnchor);
  if (!section) {
    return { updated: claudeMd, removed: [] };
  }

  const downgradedIds = extractPendingIds(readSection(gptMd, SEC.finalVerdict)?.lines.join("\n") ?? "");
  if (downgradedIds.size === 0) {
    return { updated: claudeMd, removed: [] };
  }

  const removed = [];
  const replacement = section.lines.filter((line, index) => {
    if (index === 0) {
      return true;
    }
    const ids = collectIdsFromLine(line);
    if (ids.length === 0) {
      return true;
    }
    const shouldRemove = ids.every((id) => downgradedIds.has(id));
    if (shouldRemove) {
      removed.push(stripStatusFormatting(line));
      return false;
    }
    return true;
  });

  if (removed.length === 0) {
    return { updated: claudeMd, removed };
  }

  return {
    updated: replaceSection(claudeMd, SEC.agreedAnchor, replacement),
    removed,
  };
}

function buildFixPrompt(corrections, gptMd) {
  const rejectCodes = readBulletSection(gptMd, SEC.rejectCodes);
  const resetCriteria = readBulletSection(gptMd, SEC.resetCriteria);
  const nextTasks = readBulletSection(gptMd, SEC.nextTask);
  const none = D.none_item ?? t("pdoc.none_item");

  const template = readFileSync(resolve(__dirname, cfg.plugin.fix_prompt), "utf8");
  return template
    .split("{{CORRECTIONS}}").join(corrections.map((c) => `- ${c}`).join("\n"))
    .split("{{REJECT_CODES}}").join(rejectCodes.length > 0 ? rejectCodes.map((c) => `- ${c}`).join("\n") : none)
    .split("{{RESET_CRITERIA}}").join(resetCriteria.length > 0 ? resetCriteria.map((l) => `- ${l}`).join("\n") : none)
    .split("{{NEXT_TASKS}}").join(nextTasks.length > 0 ? nextTasks.map((l) => `- ${l}`).join("\n") : none)
    .split("{{GPT_MD}}").join(gptMd)
    .split("{{WATCH_FILE}}").join(claudePath)
    .split("{{CLAUDE_MD_PATH}}").join(claudePath)
    .split("{{RESPOND_FILE}}").join(gptPath)
    .split("{{GPT_MD_PATH}}").join(gptPath)
    .split("{{TRIGGER_TAG}}").join(cfg.consensus.trigger_tag)
    .split("{{AGREE_TAG}}").join(cfg.consensus.agree_tag)
    .split("{{PENDING_TAG}}").join(cfg.consensus.pending_tag);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!existsSync(gptPath)) {
    console.log(t("respond.gpt_not_found"));
    return;
  }
  if (!existsSync(claudePath) && !args.gptOnly) {
    throw new Error(`Missing: ${claudePath}`);
  }

  let gptMd = readFileSync(gptPath, "utf8");
  const claudeMd = existsSync(claudePath) ? readFileSync(claudePath, "utf8") : "";

  const withoutProtocolSection = removeSection(gptMd, SEC.deprecatedProtocol);
  if (withoutProtocolSection !== gptMd) {
    gptMd = withoutProtocolSection;
    if (!args.dryRun) {
      writeFileSync(gptPath, gptMd, "utf8");
      console.log(t("respond.removed_deprecated", { section: SEC.deprecatedProtocol }));
    } else {
      console.log(t("respond.removed_deprecated.dryrun", { section: SEC.deprecatedProtocol }));
    }
  }

  const auditScopeSync = normalizeGptAuditScopeStatus(gptMd);
  if (auditScopeSync.changed) {
    gptMd = auditScopeSync.updated;
    if (!args.dryRun) {
      writeFileSync(gptPath, gptMd, "utf8");
      console.log(t("respond.normalized.audit_scope"));
    } else {
      console.log(t("respond.normalized.audit_scope.dryrun"));
    }
  }

  const resetCriteriaSync = normalizeResetCriteriaSection(gptMd);
  if (resetCriteriaSync.changed) {
    gptMd = resetCriteriaSync.updated;
    if (!args.dryRun) {
      writeFileSync(gptPath, gptMd, "utf8");
      console.log(t("respond.normalized.reset_criteria", { section: SEC.resetCriteria }));
    } else {
      console.log(t("respond.normalized.reset_criteria.dryrun", { section: SEC.resetCriteria }));
    }
  }

  const additionalTasksSync = normalizeAdditionalTasksSection(gptMd);
  if (additionalTasksSync.changed) {
    gptMd = additionalTasksSync.updated;
    if (!args.dryRun) {
      writeFileSync(gptPath, gptMd, "utf8");
      console.log(t("respond.normalized.additional_tasks", { section: SEC.additionalTasks }));
    } else {
      console.log(t("respond.normalized.additional_tasks.dryrun", { section: SEC.additionalTasks }));
    }
  }

  const claudeItems = parseStatusLines(claudeMd);
  const unverified = claudeItems.filter(i => i.status === triggerInner);

  let updated = claudeMd;
  const demotionSync = syncDemotedAnchors(updated, gptMd);
  updated = demotionSync.updated;
  if (demotionSync.removed.length > 0) {
    console.log(t("respond.demoting", { count: demotionSync.removed.length }));
    for (const item of demotionSync.removed) console.log(t("respond.demotion_item", { item }));
  }
  const { updated: afterApproved, synced } = syncApproved(updated, gptMd);
  updated = afterApproved;

  if (synced.length > 0) {
    console.log(t("respond.syncing", { count: synced.length, tag: cfg.consensus.agree_tag }));
    for (const s of synced) console.log(t("respond.sync_item", { item: s }));
  } else if (unverified.length === 0) {
    console.log(t("respond.no_trigger_items", { tag: cfg.consensus.trigger_tag }));
  }

  const claudeWithoutNextTask = removeSection(updated, SEC.nextTask);
  if (claudeWithoutNextTask !== updated) {
    updated = claudeWithoutNextTask;
    console.log(args.dryRun
      ? t("respond.removed_next_task.dryrun", { section: SEC.nextTask })
      : t("respond.removed_next_task", { section: SEC.nextTask }));
  }

  if (updated !== claudeMd) {
    if (!args.dryRun) {
      writeFileSync(claudePath, updated, "utf8");
      console.log(t("respond.updated", { path: claudePath }));
    } else {
      console.log(t("respond.dryrun_no_write"));
    }
  }

  const effectiveClaudeMd = updated;
  const promotionPlan = loadPromotionPlan();
  const promotionState = promotionPlan
    ? computePromotionState(
        promotionPlan,
        resolvePromotionApprovedIds(effectiveClaudeMd, gptMd),
      )
    : null;

  if (args.syncNext) {
    const gptNextSync = syncGptNextTaskWithPromotion(gptMd, effectiveClaudeMd, promotionState);
    if (gptNextSync.changed) {
      gptMd = gptNextSync.updated;
      if (!args.dryRun) {
        writeFileSync(gptPath, gptMd, "utf8");
        console.log(t("respond.normalized.next_task", { section: SEC.nextTask }));
      } else {
        console.log(t("respond.normalized.next_task.dryrun", { section: SEC.nextTask }));
      }
    }
  }

  const promotionChanged = syncPromotionDocs(gptMd, args);
  if (promotionChanged.length > 0) {
    console.log(t("respond.promotion.updated"));
    for (const file of promotionChanged) {
      console.log(t("respond.promotion.item", { file }));
    }
  }

  if (args.gptOnly) {
    if (promotionChanged.length === 0) {
      console.log(t("respond.gpt_only_complete"));
    }
    return;
  }

  const corrections = extractCorrections(gptMd);
  if (corrections.length > 0) {
    console.log(t("respond.pending_corrections", { tag: cfg.consensus.pending_tag, count: corrections.length }));
    for (const c of corrections) console.log(t("respond.correction_item", { item: c }));

    if (args.autoFix) {
      console.log(t("respond.invoking_claude"));
      const prompt = buildFixPrompt(corrections, gptMd);
      const result = spawnResolved(resolveBinary("claude", "CLAUDE_BIN"), ["-p"], {
        cwd: repoRoot,
        input: prompt,
        stdio: ["pipe", "inherit", "inherit"],
        env: { ...process.env, FEEDBACK_LOOP_ACTIVE: "1" },
        encoding: "utf8",
      });
      if (result.error) throw result.error;
      if (result.status !== 0) process.exit(result.status ?? 1);
    } else {
      console.log(t("respond.run_with_auto_fix"));
    }
  }

  // Trigger auto-retrospective only when all audit items are agreed and the last synced item was not a retrospective.
  if (synced.length > 0 && corrections.length === 0 && !args.dryRun) {
    const retroScript = cfg.plugin.retro_script;
    if (!retroScript) {
      console.log(t("respond.retro.skipped_no_script"));
    } else {
      const claudeMdNow = existsSync(claudePath) ? readFileSync(claudePath, "utf8") : "";
      const rxNums = (claudeMdNow.match(/\bRX-(\d+)\b/g) ?? []).map((m) => parseInt(m.slice(3), 10));
      const retroId = `RX-${rxNums.length > 0 ? Math.max(...rxNums) + 1 : 1}`;
      const syncedRetroLabel = synced.find((s) => /\bRX-\d+\b/.test(s));
      if (syncedRetroLabel) {
        const lastRxId = (syncedRetroLabel.match(/\bRX-\d+\b/) ?? [])[0] ?? syncedRetroLabel;
        console.log(t("respond.retro.skipped_is_retro", { rx_id: lastRxId }));
      } else {
        const remainingItems = parseStatusLines(updated).filter(
          (i) => i.status === triggerInner || i.status === pendingInner,
        );
        if (remainingItems.length === 0) {
          console.log(t("respond.retro.all_clear", { rx_id: retroId }));
          const retroScriptPath = resolve(__dirname, retroScript);
          spawnResolved(process.execPath, [retroScriptPath], {
            cwd: repoRoot,
            stdio: ["ignore", "inherit", "inherit"],
            encoding: "utf8",
          });
        }
      }
    }
  }

  if (synced.length === 0 && corrections.length === 0 && promotionChanged.length === 0) {
    console.log(t("respond.no_gpt_response"));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`feedback-respond failed: ${message}`);
    process.exit(1);
  }
}

export { collectIdsFromLine };
