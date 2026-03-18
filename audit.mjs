#!/usr/bin/env node
/* global process, console */

import { readFileSync, writeFileSync, appendFileSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { resolveBinary, spawnResolvedAsync } from "./cli-runner.mjs";
import {
  HOOKS_DIR, REPO_ROOT, cfg, plugin, consensus, safeLocale,
  SEC, t, escapeRe,
  triggerInner, agreeInner, pendingInner, STATUS_TAG_RE,
  findWatchFile, extractStatusFromLine, readSection,
  resolvePluginPath,
} from "./context.mjs";

/** Append audit-completed timestamp to gpt.md (idempotent). */
function stampAuditCompleted(path) {
  if (!existsSync(path)) return;
  let content = readFileSync(path, "utf8");
  const ts = new Date().toISOString().replace("T", " ").slice(0, 16);
  const tsLabel = t("index.timestamp.label");
  const tsLine = `\n---\n> ${tsLabel}: ${ts}\n`;
  if (content.includes(`${tsLabel}: ${ts}`)) return;
  // Remove any previous timestamp line, then append new one
  content = content.replace(/\n---\n> [^:]+: \d{4}-\d{2}-\d{2} \d{2}:\d{2}\n/g, "");
  content = content.trimEnd() + tsLine;
  writeFileSync(path, content, "utf8");
}

const promptTemplatePath = resolvePluginPath(plugin.audit_prompt);

// Lazy-initialized in main() — avoid dirname(null) crash at module load time.
let claudePath = null;
let gptPath    = null;

function initPaths() {
  claudePath = findWatchFile();
  gptPath = claudePath ? resolve(dirname(claudePath), plugin.respond_file ?? "gpt.md") : null;
}
const sessionPath = resolve(HOOKS_DIR, plugin.session_file);
const planningDirs = (consensus.planning_dirs ?? []).map((d) => resolve(REPO_ROOT, d));
const promotionDocPaths = planningDirs.map((d) => resolve(d, "feedback-promotion.md"));

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

// extractStatusFromLine → imported from context.mjs

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
  const section = readSection(markdown, heading);
  return section ? section.lines.slice(1) : [];
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
    .split("{{PROMOTION_SECTION}}").join(promotionSection)
    .split("{{CLAUDE_MD_PATH}}").join(claudePath)
    .split("{{GPT_MD_PATH}}").join(gptPath)
    .split("{{TRIGGER_TAG}}").join(cfg.consensus.trigger_tag)
    .split("{{AGREE_TAG}}").join(cfg.consensus.agree_tag)
    .split("{{PENDING_TAG}}").join(cfg.consensus.pending_tag)
    .split("{{DESIGN_DOCS_DIR}}").join(cfg.consensus.design_docs_dir ?? "docs/ko/design/**")
    .split("{{LOCALE}}").join(safeLocale)
    .split("{{REFERENCES_DIR}}").join(
      relative(REPO_ROOT, resolve(HOOKS_DIR, "templates", "references", safeLocale)).replace(/\\/g, "/"),
    );
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
    // gpt.md에 [계류] 항목이 있으면 세션 리셋 — 재개 시 orphan call 누적 방지
    if (existsSync(gptPath)) {
      try {
        const gptMd = readFileSync(gptPath, "utf8");
        if (hasPendingItems(gptMd)) {
          deleteSavedSessionId();
          console.log(t("audit.session.reset_pending"));
          return null;
        }
      } catch { /* 파일 읽기 실패 시 기존 세션 유지 */ }
    }
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
    REPO_ROOT,
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

const codexLogPath = resolve(HOOKS_DIR, "codex-session.log");

/** 라인 단위 실시간 스트리밍 — agent_message를 즉시 출력하고 threadId를 추적. */
function streamCodexOutput(child, rawJson) {
  return new Promise((resolve, reject) => {
    let threadId = null;
    const stdoutChunks = [];
    const stderrChunks = [];
    let buffer = "";

    function processLine(line) {
      if (!line) return;
      try {
        const event = JSON.parse(line);
        if (event.type === "thread.started" && typeof event.thread_id === "string") {
          threadId = event.thread_id;
        }
        if (rawJson) {
          console.log(line);
        } else if (event.type === "item.completed" && event.item?.type === "agent_message" && typeof event.item.text === "string") {
          console.log(event.item.text);
        }
      } catch {
        console.log(line);
      }
    }

    child.stdout.on("data", (chunk) => {
      stdoutChunks.push(chunk);
      buffer += chunk.toString("utf8");
      let idx;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        processLine(buffer.slice(0, idx).trim());
        buffer = buffer.slice(idx + 1);
      }
    });

    child.stderr.on("data", (chunk) => {
      stderrChunks.push(chunk);
      process.stderr.write(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (buffer.trim()) processLine(buffer.trim());

      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");

      // codex-session.log에 디버깅용 기록
      try {
        const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
        appendFileSync(codexLogPath, `\n=== [${ts}] Codex session output ===\n`);
        if (stdout) appendFileSync(codexLogPath, `[stdout]\n${stdout.slice(0, 5000)}\n`);
        if (stderr) appendFileSync(codexLogPath, `[stderr]\n${stderr.slice(0, 2000)}\n`);
      } catch { /* ignore logging failures */ }

      resolve({ stdout, stderr, threadId, exitCode: code });
    });
  });
}

function runRespond(args) {
  if (!args.sync && !args.pickNext && !args.autoFix) {
    return;
  }

  const respondArgs = [resolve(HOOKS_DIR, "respond.mjs")];
  if (args.autoFix) {
    respondArgs.push("--auto-fix");
  }
  if (!args.pickNext) {
    respondArgs.push("--no-sync-next");
  }

  const result = spawnSync(process.execPath, respondArgs, {
    cwd: REPO_ROOT,
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

async function main() {
  const args = parseArgs(process.argv.slice(2));

  initPaths();

  if (args.resetSession) {
    deleteSavedSessionId();
  }

  if (!claudePath || !existsSync(claudePath)) {
    throw new Error(`Missing watch file: ${claudePath ?? consensus.watch_file}`);
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

  const child = spawnResolvedAsync(codexBin, codexArgs, {
    cwd: REPO_ROOT,
    stdio: ["pipe", "pipe", "pipe"],
  });

  // 프롬프트를 stdin으로 전달 후 닫기
  child.stdin.write(prompt);
  child.stdin.end();

  const { threadId, exitCode } = await streamCodexOutput(child, args.json);

  if (exitCode !== 0) {
    process.exit(exitCode ?? 1);
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
  stampAuditCompleted(gptPath);
}

const auditLockPath = resolve(REPO_ROOT, ".claude", "audit.lock");
main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`feedback-audit failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    // 정상/에러 모두 락 해제 — 다음 감사가 시작될 수 있도록
    try { rmSync(auditLockPath, { force: true }); } catch { /* ignore */ }
  });
