#!/usr/bin/env node
/* global process, console */

/**
 * Automatic retrospective script.
 *
 * Called by respond.mjs immediately after all audit items are closed as [agreed].
 * 1. Extracts recently agreed items from the watch file and passes them as context.
 * 2. Injects context into the retro-prompt.md template.
 * 3. Runs the retrospective via `claude -p` (answers three questions + implements improvements).
 * 4. A retrospective block ([trigger_tag] RX-N) is appended to the watch file.
 * 5. Calls audit.mjs directly to start the next audit cycle.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBinary, spawnResolved } from "./cli-runner.mjs";
import { createT } from "./i18n.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");
const cfg = JSON.parse(readFileSync(resolve(__dirname, "config.json"), "utf8"));
const t = createT(cfg.plugin.locale ?? "en");

const claudePathPlugin = resolve(__dirname, cfg.consensus.watch_file);
const claudePathRepo   = resolve(repoRoot, cfg.consensus.watch_file);
const claudePath = existsSync(claudePathPlugin) ? claudePathPlugin : claudePathRepo;

/** Counts existing RX-N entries to determine the next sequential retrospective ID. */
function nextRetroId(claudeMd) {
  const matches = claudeMd.match(/\bRX-(\d+)\b/g) ?? [];
  const nums = matches.map((m) => parseInt(m.slice(3), 10));
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  return `RX-${max + 1}`;
}

/** Extracts agreed items listed under the agreed_anchor section of the watch file. */
function extractAgreedContext(claudeMd, agreedAnchor) {
  const lines = claudeMd.split(/\r?\n/);
  const anchorRe = new RegExp(`^##\\s+${agreedAnchor}\\s*$`);
  const start = lines.findIndex((l) => anchorRe.test(l.trim()));
  if (start < 0) return t("retro.no_agreed_items");

  const end = lines.findIndex((l, i) => i > start && /^##\s+/.test(l.trim()));
  const section = (end < 0 ? lines.slice(start + 1) : lines.slice(start + 1, end))
    .filter((l) => l.trim().startsWith("- "))
    .slice(-10); // last 10 entries only

  return section.length > 0 ? section.join("\n") : t("retro.no_agreed_items");
}

function buildPrompt(templatePath, rxId, agreedItems) {
  let tpl = readFileSync(templatePath, "utf8");
  tpl = tpl.replace(/\{\{CLAUDE_MD_PATH\}\}/g, claudePath);
  tpl = tpl.replace(/\{\{RX_ID\}\}/g, rxId);
  tpl = tpl.replace(/\{\{AGREED_ITEMS\}\}/g, agreedItems);
  tpl = tpl.replace(/\{\{TRIGGER_TAG\}\}/g, cfg.consensus.trigger_tag);
  tpl = tpl.replace(/\{\{AGREE_TAG\}\}/g, cfg.consensus.agree_tag);
  tpl = tpl.replace(/\{\{PENDING_TAG\}\}/g, cfg.consensus.pending_tag);
  return tpl;
}

function main() {
  if (!existsSync(claudePath)) {
    console.log(t("retro.no_claude_md"));
    return;
  }

  const templatePath = resolve(__dirname, cfg.plugin.retro_prompt ?? "templates/retro-prompt.md");
  if (!existsSync(templatePath)) {
    console.log(t("retro.no_template", { path: templatePath }));
    return;
  }

  const claudeMd = readFileSync(claudePath, "utf8");
  const rxId = nextRetroId(claudeMd);
  const agreedAnchor = cfg.consensus.sections?.agreed_anchor ?? "합의완료";
  const agreedItems = extractAgreedContext(claudeMd, agreedAnchor);
  const prompt = buildPrompt(templatePath, rxId, agreedItems);

  console.log(t("retro.invoking", { rx_id: rxId }));

  // FEEDBACK_LOOP_ACTIVE=1 — prevents the hook from firing recursively inside the child claude -p session.
  const claudeBin = resolveBinary("claude", "CLAUDE_BIN");
  const result = spawnResolved(claudeBin, ["-p"], {
    cwd: repoRoot,
    input: prompt,
    stdio: ["pipe", "inherit", "inherit"],
    env: { ...process.env, FEEDBACK_LOOP_ACTIVE: "1" },
    encoding: "utf8",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.log(t("retro.claude_failed", { code: result.status ?? 1 }));
    return;
  }

  // Verify that the RX entry was actually written to the watch file after claude -p completed.
  const claudeMdAfter = existsSync(claudePath) ? readFileSync(claudePath, "utf8") : "";
  if (!claudeMdAfter.includes(rxId)) {
    console.log(t("retro.no_rx_written", { rx_id: rxId }));
    return;
  }

  console.log(t("retro.done", { rx_id: rxId }));

  // Immediately trigger the next audit cycle.
  const auditScript = resolve(__dirname, cfg.plugin.audit_script ?? "audit.mjs");
  if (existsSync(auditScript)) {
    console.log(t("retro.audit_trigger"));
    const auditResult = spawnResolved(process.execPath, [auditScript], {
      cwd: repoRoot,
      stdio: ["ignore", "inherit", "inherit"],
      encoding: "utf8",
    });
    if (auditResult.error) {
      console.error(`audit failed: ${auditResult.error.message}`);
    }
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`retrospective failed: ${message}`);
  process.exit(1);
}
