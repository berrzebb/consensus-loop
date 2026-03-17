#!/usr/bin/env node
/* global process, Buffer */

/**
 * Hook: SubagentStop
 *
 * Fires when an implementer subagent completes in the orchestrator session.
 * Reads the retro marker to detect deferred retrospectives and injects
 * context so the orchestrator can pick up the retrospective.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MARKER_PATH = resolve(__dirname, ".session-state", "retro-marker.json");

// ── Read stdin (SubagentStop payload) ────────────────────
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const raw = Buffer.concat(chunks).toString("utf8").trim();

let payload = {};
try { payload = JSON.parse(raw); } catch { /* no valid payload */ }

const agentName = payload.agent_name || "unknown";

// ── Load i18n lazily ─────────────────────────────────────
const { t } = await import("./context.mjs");

// ── Check deferred retro marker ──────────────────────────
let retroDeferred = false;
let retroContext = null;

try {
  if (existsSync(MARKER_PATH)) {
    const marker = JSON.parse(readFileSync(MARKER_PATH, "utf8"));
    if (marker.retro_pending && marker.deferred_to_orchestrator) {
      retroDeferred = true;
      retroContext = {
        rx_id: marker.rx_id,
        agreed_items: marker.agreed_items,
      };

      // Consume the deferral flag — orchestrator now owns the retro
      // Keep retro_pending=true so session-gate enforces the protocol
      writeFileSync(MARKER_PATH, JSON.stringify({
        ...marker,
        deferred_to_orchestrator: false,
        consumed_by_orchestrator: true,
        consumed_at: new Date().toISOString(),
      }, null, 2), "utf8");
    }
  }
} catch { /* marker read/write error — non-fatal */ }

// ── Build output ─────────────────────────────────────────
const lines = [];
lines.push(t("subagent.stop.completed", { agent: agentName }));

if (retroDeferred && retroContext) {
  lines.push("");
  lines.push(t("subagent.stop.deferred_retro", {
    rx_id: retroContext.rx_id,
    items: retroContext.agreed_items,
  }));
}

if (lines.length > 0) {
  process.stdout.write(lines.join("\n"));
}
