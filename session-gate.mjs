#!/usr/bin/env node
/* global process, Buffer */

/**
 * PreToolUse hook: session self-improvement protocol gate.
 *
 * 1. Check marker file first — exit immediately without reading stdin if not retro_pending (minimal overhead)
 * 2. Only parse stdin when retro_pending → per-tool allow/block decision
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MARKER_DIR = resolve(__dirname, ".session-state");
const MARKER_PATH = resolve(MARKER_DIR, "retro-marker.json");
const COMPLETION_CMD = "session-self-improvement-complete";
const ALLOWED_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", "TodoWrite"];

function read_marker() {
  try {
    return JSON.parse(readFileSync(MARKER_PATH, "utf8"));
  } catch {
    return null;
  }
}

function write_marker(data) {
  if (!existsSync(MARKER_DIR)) mkdirSync(MARKER_DIR, { recursive: true });
  writeFileSync(MARKER_PATH, JSON.stringify(data, null, 2), "utf8");
}

// Check marker — exit immediately if not retro_pending
const marker = read_marker();
if (!marker || !marker.retro_pending) {
  process.exit(0);
}

// Load i18n only when retro is pending (avoid overhead on every tool call)
const { t } = await import("./context.mjs");

// retro_pending일 때만 stdin 읽기
let raw;
try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  raw = Buffer.concat(chunks).toString("utf8").trim();
} catch {
  // stdin read error (e.g. closed unexpectedly) — fail open
  process.exit(0);
}
if (!raw) { process.exit(0); }

let input;
try { input = JSON.parse(raw); } catch { process.exit(0); }

// Session isolation: pass through if marker's session_id differs from current
const current_session = input.session_id || "";
if (marker.session_id && current_session && marker.session_id !== current_session) {
  process.exit(0);
}

// Subagent pass-through: forked contexts (implementer, planner, etc.) are allowed
// They are doing implementation work, not committing — gate only blocks the main session
const is_subagent = input.parent_tool_use_id != null;
if (is_subagent) {
  process.exit(0);
}

const tool_name = input.tool_name || "";

// Completion command → release marker
if (tool_name === "Bash") {
  const command = input.tool_input?.command || "";
  if (command.includes(COMPLETION_CMD)) {
    write_marker({
      retro_pending: false,
      completed_at: new Date().toISOString(),
    });
    process.exit(0);
  }
}

// Memory-related tools → allow
if (ALLOWED_TOOLS.includes(tool_name)) {
  if (!marker.instructions_shown) {
    write_marker({ ...marker, instructions_shown: true });
    const context = marker.agreed_items || t("retro.no_agreed_items");
    process.stdout.write(t("gate.protocol", { context }));
  }
  process.exit(0);
}

// Bash/Agent etc. → block
process.stdout.write(t("gate.blocked", { tool: tool_name }));
process.exit(2);
