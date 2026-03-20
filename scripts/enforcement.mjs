#!/usr/bin/env node
/**
 * enforcement.mjs — Structural enforcement functions for roadmap features.
 *
 * These are NOT guidelines — they are code that runs automatically:
 * - countTrackPendings: count rejection rounds per track
 * - blockDownstreamTasks: auto-block dependent tasks when upstream is delayed
 * - parseResidualRisk: extract tech debt from evidence
 * - appendTechDebt: auto-register debt in work-catalog
 * - checkFalsePositiveRate: detect audit quality degradation
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";

/**
 * Count pending verdicts for a track in audit history.
 * @param {string} historyPath - Path to audit-history.jsonl
 * @param {string} track - Track name to filter
 * @returns {number} Number of pending verdicts
 */
export function countTrackPendings(historyPath, track) {
  if (!existsSync(historyPath)) return 0;
  const lines = readFileSync(historyPath, "utf8").split(/\r?\n/).filter(l => l.trim());
  let count = 0;
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.track === track && entry.verdict === "pending") count++;
    } catch { /* skip malformed */ }
  }
  return count;
}

/**
 * Auto-block downstream tasks when upstream track exceeds rejection threshold.
 * @param {string} handoffPath - Path to session-handoff.md
 * @param {string} blockedTrack - Track that is delayed/rejected
 * @param {string} reason - Reason string (e.g., "upstream PA rejected 3x")
 * @returns {number} Number of tasks blocked
 */
export function blockDownstreamTasks(handoffPath, blockedTrack, reason) {
  if (!existsSync(handoffPath)) return 0;
  let content = readFileSync(handoffPath, "utf8");
  const lines = content.split(/\r?\n/);
  let blocked = 0;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("**depends_on**") && lines[i].includes(blockedTrack)) {
      for (let j = Math.max(0, i - 3); j < i; j++) {
        if (lines[j].includes("**status**") && !lines[j].includes("done")) {
          lines[j] = lines[j].replace(
            /\*\*status\*\*:\s*\S+/,
            `**status**: blocked (${reason})`
          );
          blocked++;
          break;
        }
      }
    }
  }

  if (blocked > 0) {
    writeFileSync(handoffPath, lines.join("\n"), "utf8");
  }
  return blocked;
}

/**
 * Parse Residual Risk items from evidence content.
 * @param {string} evidenceContent - Full evidence markdown
 * @returns {string[]} List of risk items (excluding "None"/"없음")
 */
export function parseResidualRisk(evidenceContent) {
  const lines = evidenceContent.split(/\r?\n/);
  let inRisk = false;
  const risks = [];

  for (const line of lines) {
    if (/^###\s+Residual Risk/i.test(line.trim())) {
      inRisk = true;
      continue;
    }
    if (inRisk && /^###?\s+/.test(line.trim())) break;
    if (inRisk && line.trim().startsWith("- ")) {
      const text = line.trim().replace(/^- /, "").trim();
      if (text && !/^none$/i.test(text) && !/^없음$/i.test(text)) {
        risks.push(text);
      }
    }
  }
  return risks;
}

/**
 * Auto-append tech debt to work-catalog. Skips duplicates.
 * @param {string} catalogPath - Path to work-catalog.md
 * @param {string[]} debts - List of debt descriptions
 * @param {string} track - Source track name
 * @returns {number} Number of items appended
 */
export function appendTechDebt(catalogPath, debts, track) {
  let content = existsSync(catalogPath) ? readFileSync(catalogPath, "utf8") : "";
  let appended = 0;

  for (const debt of debts) {
    if (content.includes(debt)) continue;
    const entry = `| TD-auto | ${debt} | tech-debt | — | low | ${track} |`;
    content = content.trimEnd() + "\n" + entry + "\n";
    appended++;
  }

  if (appended > 0) {
    writeFileSync(catalogPath, content, "utf8");
  }
  return appended;
}

/**
 * Check if a rejection code has excessive false positive rate.
 * @param {string} historyPath - Path to audit-history.jsonl
 * @param {string} track - Track to analyze
 * @param {number} minRounds - Minimum rounds before analysis applies
 * @returns {{ needsReview: boolean, codes: string[] }}
 */
export function checkFalsePositiveRate(historyPath, track, minRounds = 5) {
  if (!existsSync(historyPath)) return { needsReview: false, codes: [] };
  const lines = readFileSync(historyPath, "utf8").split(/\r?\n/).filter(l => l.trim());

  const entries = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.track === track) entries.push(entry);
    } catch { /* skip */ }
  }

  if (entries.length < minRounds) return { needsReview: false, codes: [] };

  const codeStats = {};
  for (const entry of entries) {
    for (const rc of (entry.rejection_codes || [])) {
      const code = typeof rc === "string" ? rc : rc.code;
      const fp = typeof rc === "object" && rc.false_positive === true;
      if (!codeStats[code]) codeStats[code] = { total: 0, fp: 0 };
      codeStats[code].total++;
      if (fp) codeStats[code].fp++;
    }
  }

  const flagged = [];
  for (const [code, stats] of Object.entries(codeStats)) {
    if (stats.total >= 3 && (stats.fp / stats.total) > 0.3) {
      flagged.push(code);
    }
  }

  return { needsReview: flagged.length > 0, codes: flagged };
}
