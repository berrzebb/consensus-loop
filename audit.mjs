#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { resolveBinary, spawnResolved } from "./cli-runner.mjs";
import { createT } from "./i18n.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");
const cfg = JSON.parse(readFileSync(resolve(__dirname, "config.json"), "utf8"));
const t = createT(cfg.plugin.locale ?? "en");

// Section heading constants pulled from config — protocol identifiers, not UI messages.
const S = cfg.consensus.sections ?? {};
const SEC = {
  auditScope:      S.audit_scope      ?? "감사 범위",
  promotionTarget: S.promotion_target ?? "현재 승격 대상",
  changedFiles:    S.changed_files    ?? "변경 파일",
  nextTask:        S.next_task        ?? "다음 작업",
};

const promptTemplatePath = resolve(__dirname, cfg.plugin.audit_prompt);
const claudePathPlugin   = resolve(__dirname, cfg.consensus.watch_file);
const claudePathRepo     = resolve(repoRoot, cfg.consensus.watch_file);
const claudePath = existsSync(claudePathPlugin) ? claudePathPlugin : claudePathRepo;
const gptPath    = resolve(dirname(claudePath), cfg.plugin.respond_file ?? "gpt.md");
const sessionPath = resolve(__dirname, cfg.plugin.session_file);
const planningDirs = (cfg.consensus.planning_dirs ?? []).map((d) => resolve(repoRoot, d));
const promotionDocPaths = planningDirs.map((d) => resolve(d, "feedback-promotion.md"));
const triggerInner = cfg.consensus.trigger_tag.replace(/^\[|\]$/g, "");
const agreeInner   = cfg.consensus.agree_tag.replace(/^\[|\]$/g, "");
const pendingInner = cfg.consensus.pending_tag.replace(/^\[|\]$/g, "");
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const STATUS_TAG_RE = new RegExp(
  `\\[(${[agreeInner, pendingInner, triggerInner].map(escapeRe).join("|")})(?:[^\\]]*?)\\]`,
);

function usage() {
  console.log(`Usage: node .claude/hooks/consensus-loop/audit.mjs [options]

Options:
  --scope <text>     Override audit scope shown to Codex
  --model <name>     Pass a model to codex exec (default: gpt-5.4)
  --sandbox <mode>   Pass a sandbox mode to codex exec (default: danger-full-access)
                     danger-full-access also enables no-approval execution on resume/new sessions
  --session-id <id>  Resume a specific Codex audit session id
  --resume-last      Resume the most recent Codex session in this repo
  --no-resume        Always start a new Codex session
  --reset-session    Delete the saved audit session id before running
  --debug-bin        Print the resolved Codex executable before running
  --auto-fix         Run respond.mjs with --auto-fix after audit
  --no-sync          Skip respond.mjs after audit
  --no-pick-next     Skip syncing the next-task section after audit
  --dry-run          Print the generated prompt and exit
  --json             Print raw Codex JSON output instead of parsed agent messages
  -h, --help         Show this help

Environment:
  CODEX_BIN          Override the Codex executable path

Examples:
  node .claude/hooks/consensus-loop/audit.mjs
  node .claude/hooks/consensus-loop/audit.mjs --scope "Observability Layer / Bundle O3"
  node .claude/hooks/consensus-loop/audit.mjs --model gpt-5.4
  node .claude/hooks/consensus-loop/audit.mjs --resume-last
  node .claude/hooks/consensus-loop/audit.mjs --reset-session
  node .claude/hooks/consensus-loop/audit.mjs --auto-fix
`);
}

function parseArgs(argv) {
  const args = {
    scope: null,
    model: "gpt-5.4",
    sandbox: "danger-full-access",
    sessionId: null,
    resumeLast: false,
    resume: true,
    resetSession: false,
    debugBin: false,
    autoFix: false,
    dryRun: false,
    json: false,
    sync: true,
    pickNext: true,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--scope") {
      args.scope = argv[++i] ?? null;
      continue;
    }
    if (arg === "--model") {
      args.model = argv[++i] ?? null;
      continue;
    }
    if (arg === "--sandbox") {
      args.sandbox = argv[++i] ?? null;
      continue;
    }
    if (arg === "--session-id") {
      args.sessionId = argv[++i] ?? null;
      continue;
    }
    if (arg === "--resume-last") {
      args.resumeLast = true;
      continue;
    }
    if (arg === "--no-resume") {
      args.resume = false;
      continue;
    }
    if (arg === "--reset-session") {
      args.resetSession = true;
      continue;
    }
    if (arg === "--debug-bin") {
      args.debugBin = true;
      continue;
    }
    if (arg === "--auto-fix") {
      args.autoFix = true;
      continue;
    }
    if (arg === "--no-sync") {
      args.sync = false;
      continue;
    }
    if (arg === "--no-pick-next") {
      args.pickNext = false;
      continue;
    }
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function readSavedSession() {
  if (!existsSync(sessionPath)) {
    return null;
  }

  try {
    const stored = JSON.parse(readFileSync(sessionPath, "utf8"));
    if (!stored.id) return null;
    // mtime check removed: CLAUDE.md edits (new evidence) must not destroy the session.
    // Session resets only when all items reach agree_tag (see deleteSavedSessionId).
    return stored.id;
  } catch {
    // Parse failure → invalidate
    return null;
  }
}

function writeSavedSession(sessionId) {
  writeFileSync(sessionPath, JSON.stringify({ id: sessionId }) + "\n", "utf8");
}

function deleteSavedSessionId() {
  if (existsSync(sessionPath)) {
    rmSync(sessionPath, { force: true });
  }
}

function extractStatusFromLine(line) {
  const match = line.match(STATUS_TAG_RE);
  if (!match) {
    return null;
  }

  const innerRe = new RegExp([agreeInner, pendingInner, triggerInner].map(escapeRe).join("|"), "g");
  const statuses = [...match[0].matchAll(innerRe)].map((item) => item[0]);
  return statuses.at(-1) ?? null;
}

function hasPendingItems(markdown) {
  return new RegExp(`\\[(${escapeRe(triggerInner)}|${escapeRe(pendingInner)})\\]`).test(markdown);
}

function detectScope(markdown) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^##\\s+${escapeRe(SEC.auditScope)}\\s*$`).test(line.trim()));
  const end = start >= 0
    ? lines.findIndex((line, idx) => idx > start && /^##\s+/.test(line.trim()))
    : -1;
  const section = start >= 0
    ? lines.slice(start + 1, end >= 0 ? end : lines.length)
    : lines;

  const normalized = section
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "));

  const pending = normalized.filter((line) => extractStatusFromLine(line) === triggerInner);
  if (pending.length > 0) {
    return pending.map((line) => line.replace(/^- /, "")).join("\n");
  }

  const fallback = normalized.filter((line) => extractStatusFromLine(line) === pendingInner);
  if (fallback.length > 0) {
    return fallback.map((line) => line.replace(/^- /, "")).join("\n");
  }

  return t("audit.scope.fallback", { file: cfg.consensus.watch_file });
}

function readSectionLines(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^##\\s+${heading}\\s*$`).test(line.trim()));
  if (start < 0) {
    return [];
  }
  const end = lines.findIndex((line, idx) => idx > start && /^##\s+/.test(line.trim()));
  return lines.slice(start + 1, end >= 0 ? end : lines.length);
}

function loadPromotionHint() {
  for (const docPath of promotionDocPaths) {
    if (!existsSync(docPath)) {
      continue;
    }

    const markdown = readFileSync(docPath, "utf8");
    const lines = readSectionLines(markdown, SEC.promotionTarget).concat(readSectionLines(markdown, "Current Promotion Target"));
    const firstBullet = lines
      .map((line) => line.trim())
      .find((line) => line.startsWith("- "));

    if (firstBullet) {
      return {
        docPath,
        nextTask: firstBullet.replace(/^- /, "").trim(),
      };
    }
  }

  return null;
}

function buildPromotionSection(promotionHint) {
  if (!promotionHint) return "";
  return t("audit.promotion.agree_label", {
    agree_tag:         cfg.consensus.agree_tag,
    source:            promotionHint.docPath.replace(/\\/g, "/"),
    next_task:         promotionHint.nextTask,
    next_task_section: SEC.nextTask,
  });
}

/**
 * Compare the "changed files" list in trigger_tag blocks against the eslint scope in "Test Command".
 * Returns warnings for any test file present in changed files but missing from the eslint command.
 */
function checkEslintCoverage(markdown) {
  const warnings = [];
  const h2Blocks = markdown.split(/(?=^## )/m);

  for (const block of h2Blocks) {
    if (!block.includes(cfg.consensus.trigger_tag)) continue;

    const headingMatch = block.match(/^## (.+)/);
    const heading = headingMatch ? headingMatch[1].trim() : "(unknown)";

    // Extract paths from the "changed files" section
    const changedFilesMatch = block.match(new RegExp(`### ${escapeRe(SEC.changedFiles)}\\n([\\s\\S]*?)(?=\\n###|\\n---|\\n## |$)`));
    const changedFiles = changedFilesMatch
      ? [...changedFilesMatch[1].matchAll(/- `([^`]+)`/g)].map((m) => m[1])
      : [];

    // Extract the eslint line from the "Test Command" section
    const testCmdMatch = block.match(/### Test Command\n[\s\S]*?```[^\n]*\n([\s\S]*?)```/);
    const eslintLine = testCmdMatch
      ? (testCmdMatch[1].split("\n").find((l) => /npx eslint/.test(l)) ?? "")
      : "";

    const eslintTokens = eslintLine.split(/\s+/).filter((t) => t && !t.startsWith("-") && t !== "npx" && t !== "eslint");
    const eslintSet = new Set(eslintTokens);

    const missing = changedFiles.filter((f) => !eslintSet.has(f));
    if (missing.length > 0) {
      warnings.push({ heading, missing });
    }
  }

  return warnings;
}

function buildPrompt(scopeText, promotionHint) {
  const template = readFileSync(promptTemplatePath, "utf8");
  const promotionSection = buildPromotionSection(promotionHint);
  return template
    .split("{{SCOPE}}").join(scopeText)
    .split("{{PROMOTION_SECTION}}").join(promotionSection);
}

function resolveCodexBin() {
  return resolveBinary("codex", "CODEX_BIN");
}

function determineResumeTarget(args) {
  if (args.resume === false) {
    return null;
  }

  if (args.sessionId) {
    return { type: "session", value: args.sessionId };
  }

  const saved = readSavedSession();
  if (saved) {
    return { type: "session", value: saved };
  }

  if (args.resumeLast) {
    return { type: "last", value: null };
  }

  return null;
}

function buildCodexArgs(args, resumeTarget) {
  const wantsFullAccess = args.sandbox === "danger-full-access";

  if (resumeTarget) {
    const base = ["exec", "resume"];

    if (args.model) {
      base.push("--model", args.model);
    }
    if (wantsFullAccess) {
      base.push("--dangerously-bypass-approvals-and-sandbox");
    }
    base.push("--json");

    if (resumeTarget.type === "last") {
      base.push("--last");
    } else {
      base.push(resumeTarget.value);
    }

    base.push("-");
    return base;
  }

  const base = [
    "exec",
    "-C",
    repoRoot,
  ];

  if (wantsFullAccess) {
    base.push("--dangerously-bypass-approvals-and-sandbox");
  } else {
    base.push("--sandbox", args.sandbox);
  }

  if (args.model) {
    base.push("--model", args.model);
  }
  base.push("--json");

  base.push("-");
  return base;
}

function emitCodexOutput(stdout, stderr, rawJson) {
  let threadId = null;
  let sawJson = false;

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    try {
      const event = JSON.parse(line);
      sawJson = true;

      if (event.type === "thread.started" && typeof event.thread_id === "string") {
        threadId = event.thread_id;
      }

      if (rawJson) {
        console.log(line);
        continue;
      }

      if (event.type === "item.completed" && event.item?.type === "agent_message" && typeof event.item.text === "string") {
        console.log(event.item.text);
      }
    } catch {
      console.log(line);
    }
  }

  if (stderr?.trim()) {
    process.stderr.write(stderr);
    if (!stderr.endsWith("\n")) {
      process.stderr.write("\n");
    }
  }

  return { threadId, sawJson };
}

function runRespond(args) {
  if (!args.sync && !args.pickNext && !args.autoFix) {
    return;
  }

  const respondArgs = [resolve(__dirname, "respond.mjs")];
  if (args.autoFix) {
    respondArgs.push("--auto-fix");
  }
  if (!args.pickNext) {
    respondArgs.push("--no-sync-next");
  }

  const result = spawnSync(process.execPath, respondArgs, {
    cwd: repoRoot,
    stdio: "inherit",
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.resetSession) {
    deleteSavedSessionId();
  }

  if (!existsSync(claudePath)) {
    throw new Error(`Missing file: ${claudePath}`);
  }

  const claudeMd = readFileSync(claudePath, "utf8");

  // Pre-check: eslint scope consistency before audit
  const eslintWarnings = checkEslintCoverage(claudeMd);
  if (eslintWarnings.length > 0) {
    console.warn(t("audit.eslint.mismatch_header"));
    for (const { heading, missing } of eslintWarnings) {
      console.warn(t("audit.eslint.heading", { heading }));
      for (const f of missing) {
        console.warn(t("audit.eslint.missing", { file: f }));
      }
    }
    console.warn("");
  }

  if (!args.scope && !hasPendingItems(claudeMd)) {
    console.log(t("audit.no_pending", { trigger: cfg.consensus.trigger_tag, pending: cfg.consensus.pending_tag }));
    runRespond(args);
    return;
  }

  const scopeText = args.scope ?? detectScope(claudeMd);
  const promotionHint = loadPromotionHint();
  const prompt = buildPrompt(scopeText, promotionHint);
  const codexBin = resolveCodexBin();

  if (args.dryRun) {
    if (args.debugBin) {
      console.log(t("audit.debug_bin", { bin: codexBin }));
    }
    console.log(prompt);
    return;
  }

  const resumeTarget = determineResumeTarget(args);
  if (resumeTarget?.type === "session") {
    console.log(t("audit.session.resuming", { id: resumeTarget.value }));
  } else if (resumeTarget?.type === "last") {
    console.log(t("audit.session.resuming_last"));
  } else {
    console.log(t("audit.session.starting"));
  }

  const codexArgs = buildCodexArgs(args, resumeTarget);
  if (args.debugBin) {
    console.log(t("audit.debug_bin", { bin: codexBin }));
  }
  const result = spawnResolved(codexBin, codexArgs, {
    cwd: repoRoot,
    input: prompt,
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf8",
  });

  const { threadId } = emitCodexOutput(result.stdout ?? "", result.stderr ?? "", args.json);

  if (result.error) {
    if (result.error instanceof Error && "code" in result.error && result.error.code === "ENOENT") {
      throw new Error(`Could not find Codex CLI. Set CODEX_BIN or ensure 'codex' is on PATH. Attempted: ${codexBin}`);
    }
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  if (existsSync(gptPath)) {
    console.log(t("audit.updated", { path: gptPath }));
    const gptMd = readFileSync(gptPath, "utf8");
    if (!hasPendingItems(gptMd) && threadId) {
      deleteSavedSessionId();
      console.log(t("audit.session.reset", { tag: cfg.consensus.pending_tag }));
    } else if (threadId) {
      writeSavedSession(threadId);
      console.log(t("audit.session.saved", { id: threadId }));
    }
  } else if (threadId) {
    writeSavedSession(threadId);
    console.log(t("audit.session.saved", { id: threadId }));
  }

  runRespond(args);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`feedback-audit failed: ${message}`);
  process.exit(1);
}
