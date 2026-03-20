#!/usr/bin/env node
/* global process, Buffer */

/**
 * PostCompact hook: restore audit state after context compaction.
 *
 * Complements pre-compact.mjs:
 *   PreCompact  → saves snapshot to compaction-snapshot.json
 *   PostCompact → reads snapshot, injects context reinforcement
 *
 * This ensures audit state is not lost when Claude Code compresses context.
 */

import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Read stdin (pass through) ────────────────────────────────
let raw;
try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  raw = Buffer.concat(chunks).toString("utf8");
} catch {
  process.exit(0);
}

// Pass through stdin unchanged
if (raw) process.stdout.write(raw);

// ── Restore from snapshot ────────────────────────────────────
let REPO_ROOT;
try {
  const ctx = await import("./context.mjs");
  REPO_ROOT = ctx.REPO_ROOT;
} catch {
  process.exit(0);
}

const snapshotPath = resolve(REPO_ROOT, ".claude", "compaction-snapshot.json");
if (!existsSync(snapshotPath)) {
  process.exit(0);
}

try {
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
  const parts = [];

  parts.push(`<COMPACTION-RESTORE timestamp="${snapshot.saved_at}">`);

  // Restore audit state
  if (snapshot.audit_in_progress) {
    parts.push("⚠️ Audit was in progress before compaction. Check .claude/audit.lock and audit-bg.log.");
  }

  if (snapshot.last_audit_status) {
    parts.push(`📋 Last audit status: ${snapshot.last_audit_status}`);
  }

  // Restore retro marker state
  if (snapshot.retro_marker?.retro_pending) {
    parts.push("⚠️ Retrospective is pending. Complete the self-improvement protocol before proceeding.");
    if (snapshot.retro_marker.agreed_items) {
      parts.push(`Agreed items: ${snapshot.retro_marker.agreed_items}`);
    }
  }

  parts.push("</COMPACTION-RESTORE>");

  // Output restoration context to stderr (informational)
  console.error(`[post-compact] Restored state from snapshot (${snapshot.saved_at})`);

  // Note: PostCompact cannot inject additionalContext like SessionStart.
  // The restoration is informational — SessionStart handles full context reinject on next session.

} catch (e) {
  console.error(`[post-compact] Snapshot restore warning: ${e.message}`);
}

process.exit(0);
