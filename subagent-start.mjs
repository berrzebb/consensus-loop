#!/usr/bin/env node
/* global process, Buffer */

/**
 * SubagentStart hook: inject protocol context into implementer/scout agents.
 *
 * Provides runtime audit state, track context, and diff basis information
 * so agents start with current situational awareness instead of static .md files only.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

const agentType = input.agent_type || "";

// Only inject for implementer and scout agents
if (!["implementer", "scout"].includes(agentType)) {
  process.exit(0);
}

// ── Gather runtime context ───────────────────────────────────
const contextParts = [];

// 1. Current audit state (from retro-marker)
try {
  const markerPath = resolve(__dirname, ".session-state", "retro-marker.json");
  if (existsSync(markerPath)) {
    const marker = JSON.parse(readFileSync(markerPath, "utf8"));
    if (marker.retro_pending) {
      contextParts.push(`⚠️ Retrospective is pending. Agreed items: ${marker.agreed_items || "none"}`);
    }
  }
} catch { /* marker read error — skip */ }

// 2. Pending audit status (from watch file)
try {
  const { REPO_ROOT, consensus, findWatchFile, findRespondFile, STATUS_TAG_RE } = await import("./context.mjs");

  const watchPath = findWatchFile();
  if (watchPath && existsSync(watchPath)) {
    const watchContent = readFileSync(watchPath, "utf8");
    const lines = watchContent.split("\n");

    // Extract diff basis from evidence
    for (const line of lines) {
      if (line.includes("git diff") && line.includes("..")) {
        contextParts.push(`📋 Evidence diff basis: ${line.trim()}`);
        break;
      }
    }

    // Extract current status tag
    for (const line of lines) {
      const m = STATUS_TAG_RE.exec(line);
      if (m) {
        contextParts.push(`📋 Current audit status: ${line.trim()}`);
        break;
      }
    }
  }

  // 3. Latest auditor feedback (rejection codes)
  const respondPath = findRespondFile();
  if (respondPath && existsSync(respondPath)) {
    const respondContent = readFileSync(respondPath, "utf8");
    // Extract rejection codes from pending items
    const rejections = [];
    for (const line of respondContent.split("\n")) {
      if (line.includes(consensus.pending_tag)) {
        rejections.push(line.trim());
      }
    }
    if (rejections.length > 0) {
      contextParts.push(`🔴 Pending rejections (${rejections.length}):\n${rejections.slice(0, 5).join("\n")}`);
    }
  }

  // 4. Handoff state (active tracks)
  const handoffPath = resolve(REPO_ROOT, ".claude", "session-handoff.md");
  if (existsSync(handoffPath)) {
    const handoff = readFileSync(handoffPath, "utf8");
    const inProgress = [];
    for (const line of handoff.split("\n")) {
      if (line.includes("진행 중") || line.includes("in-progress")) {
        inProgress.push(line.trim());
      }
    }
    if (inProgress.length > 0) {
      contextParts.push(`🔄 Active tracks:\n${inProgress.join("\n")}`);
    }
  }
} catch { /* context.mjs import error — skip, fail-open */ }

// 5. CC-2 diff basis reminder
contextParts.push(
  `📌 CC-2 Protocol: When writing evidence, always include a diff basis commit range ` +
  `(e.g. \`git diff --name-only <base>..<head>\`). The auditor uses this range to verify scope.`
);

// ── Output additional context ─────────────────────────────────
if (contextParts.length > 0) {
  const context = contextParts.join("\n\n");
  const output = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SubagentStart",
      additionalContext: `<CONSENSUS-LOOP-CONTEXT>\n${context}\n</CONSENSUS-LOOP-CONTEXT>`
    }
  });
  process.stdout.write(output);
}

process.exit(0);
