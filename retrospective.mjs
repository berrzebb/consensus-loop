#!/usr/bin/env node
/* global process, console */

/**
 * Set retrospective marker after audit cycle completion.
 *
 * Called by respond.mjs when all audit items are agreed.
 * Previous: ran external agent via claude -p (no HITL, no control)
 * Current: writes marker file only → session-gate.mjs enforces retro in main session (HITL capable)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  HOOKS_DIR, cfg, SEC, t, findWatchFile,
} from "./context.mjs";

const MARKER_DIR = resolve(HOOKS_DIR, ".session-state");
const MARKER_PATH = resolve(MARKER_DIR, "retro-marker.json");
const claudePath = findWatchFile();

/** Compute next RX-N sequence number. */
function nextRetroId(claudeMd) {
  const matches = claudeMd.match(/\bRX-(\d+)\b/g) ?? [];
  const nums = matches.map((m) => parseInt(m.slice(3), 10));
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  return `RX-${max + 1}`;
}

/** Extract recent items from the agreed anchor section. */
function extractAgreedContext(claudeMd, agreedAnchor) {
  const lines = claudeMd.split(/\r?\n/);
  const anchorRe = new RegExp(`^##\\s+${agreedAnchor}\\s*$`);
  const start = lines.findIndex((l) => anchorRe.test(l.trim()));
  if (start < 0) return t("retro.no_agreed_items");

  const end = lines.findIndex((l, i) => i > start && /^##\s+/.test(l.trim()));
  const section = (end < 0 ? lines.slice(start + 1) : lines.slice(start + 1, end))
    .filter((l) => l.trim().startsWith("- "))
    .slice(-10);

  return section.length > 0 ? section.join("\n") : t("retro.no_agreed_items");
}

function main() {
  if (!existsSync(claudePath)) {
    console.log(t("retro.no_claude_md"));
    return;
  }

  const claudeMd = readFileSync(claudePath, "utf8");
  const rxId = nextRetroId(claudeMd);
  const agreedAnchor = SEC.agreedAnchor;
  const agreedItems = extractAgreedContext(claudeMd, agreedAnchor);

  // Write marker file — session-gate.mjs picks it up on next PreToolUse
  // session_id is propagated via env: index.mjs → respond.mjs → retrospective.mjs
  // In subagent mode, retro is deferred to the orchestrator session (main session)
  const sessionId = process.env.RETRO_SESSION_ID || null;
  const isSubagent = process.env.PARENT_TOOL_USE_ID != null;
  // ── Rejection Code Improvement Check ──────────────────
  // Structural enforcement: auto-detect if audit quality has degraded.
  let policyReview = null;
  try {
    const { checkFalsePositiveRate } = await import("./scripts/enforcement.mjs");
    const { REPO_ROOT } = await import("./context.mjs");
    const historyPath = resolve(REPO_ROOT, ".claude", "audit-history.jsonl");
    // Extract track from agreed items (best effort)
    const trackMatch = agreedItems.match(/\b([A-Z]{2,})-\d+/);
    if (trackMatch) {
      const track = trackMatch[0].replace(/-\d+$/, "");
      const result = checkFalsePositiveRate(historyPath, track, 5);
      if (result.needsReview) {
        policyReview = result.codes;
        console.log(`[enforcement] Policy review needed for rejection codes: ${result.codes.join(", ")}`);
      }
    }
  } catch { /* enforcement is non-critical */ }

  if (!existsSync(MARKER_DIR)) mkdirSync(MARKER_DIR, { recursive: true });
  writeFileSync(MARKER_PATH, JSON.stringify({
    retro_pending: true,
    session_id: sessionId,
    rx_id: rxId,
    agreed_items: agreedItems,
    instructions_shown: false,
    deferred_to_orchestrator: isSubagent,
    policy_review_needed: policyReview,
    created_at: new Date().toISOString(),
  }, null, 2), "utf8");

  console.log(t("retro.marker_set", { rx_id: rxId }));
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`retrospective marker failed: ${message}`);
  process.exit(1);
}
