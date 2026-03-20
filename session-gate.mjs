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

// Hook toggle — only checked when retro is pending (no overhead on normal path)
try {
  const cfgPath = (() => {
    const pr = process.env.CLAUDE_PLUGIN_ROOT;
    if (pr) { const p = resolve(pr, "config.json"); if (existsSync(p)) return p; }
    return resolve(__dirname, "config.json");
  })();
  const c = JSON.parse(readFileSync(cfgPath, "utf8"));
  if (c.plugin?.hooks_enabled?.session_gate === false) process.exit(0);
} catch { /* config read error — default: enabled */ }

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
  const cmdTrimmed = command.trim();
  if (cmdTrimmed === COMPLETION_CMD ||
      cmdTrimmed === `echo ${COMPLETION_CMD}` ||
      /^echo\s+["']?session-self-improvement-complete["']?\s*$/.test(cmdTrimmed)) {
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
    let output = t("gate.protocol", { context });

    // Structural enforcement: inject policy review requirement into retrospective
    if (marker.policy_review_needed && marker.policy_review_needed.length > 0) {
      output += `\n\n⚠️ **[ENFORCEMENT] Policy Review Required**\n`;
      output += `The following rejection codes have >30% false positive rate and need policy file review:\n`;
      for (const code of marker.policy_review_needed) {
        output += `- \`${code}\` → check \`templates/references/{locale}/rejection-codes.md\` and \`test-checklist.md\`\n`;
      }
      output += `\nThis is a structural enforcement, not a suggestion. Address before completing retrospective.\n`;
    }

    process.stdout.write(output);
  }
  process.exit(0);
}

// Bash/Agent etc. → block
process.stdout.write(t("gate.blocked", { tool: tool_name }));
process.exit(2);
