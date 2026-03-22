#!/usr/bin/env node
/* global process, console */

import { readFileSync, writeFileSync, appendFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
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

function initPaths(overrideWatchFile) {
  claudePath = overrideWatchFile && existsSync(overrideWatchFile) ? overrideWatchFile : findWatchFile();
  gptPath = claudePath ? resolve(dirname(claudePath), plugin.respond_file ?? "gpt.md") : null;
}
// Session path: per-worktree when --watch-file is in a worktree, else HOOKS_DIR
function getSessionPath() {
  return _sessionDir
    ? resolve(_sessionDir, plugin.session_file)
    : resolve(HOOKS_DIR, plugin.session_file);
}
let _sessionDir = null;
const planningDirs = (consensus.planning_dirs ?? []).map((d) => resolve(REPO_ROOT, d));
const promotionDocPaths = planningDirs.map((d) => resolve(d, "feedback-promotion.md"));

function usage() {
  console.log(`Usage: node .claude/quorum audit [options]

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
  node .claude/quorum audit
  node .claude/quorum audit --scope "Observability Layer / Bundle O3"
  node .claude/quorum audit --model gpt-5.4
  node .claude/quorum audit --resume-last
  node .claude/quorum audit --reset-session
  node .claude/quorum audit --auto-fix
`);
}

function parseArgs(argv) {
  const args = {
    scope: null,
    watchFile: null,
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
    if (arg === "--watch-file") {
      args.watchFile = argv[++i] ?? null;
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
  const sp = getSessionPath();
  if (!existsSync(sp)) return null;
  try {
    const stored = JSON.parse(readFileSync(sp, "utf8"));
    if (!stored.id) return null;
    return stored.id;
  } catch {
    return null;
  }
}

function writeSavedSession(sessionId) {
  const sp = getSessionPath();
  mkdirSync(dirname(sp), { recursive: true });
  writeFileSync(sp, JSON.stringify({ id: sessionId }) + "\n", "utf8");
}

function deleteSavedSessionId() {
  const sp = getSessionPath();
  if (existsSync(sp)) rmSync(sp, { force: true });
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

/**
 * Run all deterministic verifications LOCALLY before invoking the auditor.
 *
 * The auditor receives pre-computed results instead of running commands
 * in its own sandbox (which may have stale state).
 *
 * Returns a markdown section with:
 *   - Changed files (from git)
 *   - CQ-1: eslint results per changed file
 *   - CQ-2: tsc --noEmit results
 *   - T: test command results (from evidence)
 */
function runPreVerification(markdown, cwd) {
  const root = cwd || REPO_ROOT;
  const sections = [];

  // 1. Changed files (CC-2)
  sections.push(computeChangedFiles(markdown, root));

  // 2. CQ-2: tsc --noEmit (root + web if exists)
  sections.push(runTscLocally(root));

  // 3. CQ-1: eslint on changed source files
  const changedFiles = extractChangedFilesFromEvidence(markdown);
  sections.push(runEslintLocally(changedFiles, root));

  // 4. T: re-run test commands from evidence
  const testCmds = extractTestCommands(markdown);
  sections.push(runTestsLocally(testCmds, root));

  return sections.join("\n\n");
}

/** Extract file paths from ### Changed Files section in evidence. */
function extractChangedFilesFromEvidence(markdown) {
  const section = readSection(markdown, "Changed Files");
  if (!section) return [];
  return section
    .split("\n")
    .map(line => line.match(/`([^`]+\.[a-zA-Z]+)`/))
    .filter(Boolean)
    .map(m => m[1]);
}

/** Extract test commands from ### Test Command section in evidence. */
function extractTestCommands(markdown) {
  const section = readSection(markdown, "Test Command");
  if (!section) return [];
  // Extract lines inside code blocks or plain command lines
  return section
    .split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("```") && !l.startsWith("#") && !l.startsWith("//"))
    .filter(l => l.match(/^(npx|npm|node|vitest|jest|cargo|python|python3|py|ruff|go |make|pytest)/));
}

/** Run tsc --noEmit locally and return results. */
function runTscLocally(root) {
  const results = ["### CQ-2: TypeScript Check (pre-verified locally)"];
  if (!existsSync(resolve(root, "tsconfig.json"))) return results.join("\n");

  const rootTsc = spawnSync("npx", ["tsc", "--noEmit"], {
    cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 60000, shell: true,
  });
  results.push(`**Root \`npx tsc --noEmit\`**: ${rootTsc.status === 0 ? "✅ 0 errors" : "❌ FAILED"}`);
  if (rootTsc.status !== 0) {
    const output = (rootTsc.stdout || rootTsc.stderr || "").trim();
    if (output) results.push("```\n" + output.slice(0, 1000) + "\n```");
  }

  const webTsconfig = resolve(root, "web", "tsconfig.json");
  if (existsSync(webTsconfig)) {
    const webTsc = spawnSync("npx", ["tsc", "--noEmit", "-p", "web/tsconfig.json"], {
      cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 60000, shell: true,
    });
    results.push(`**Web \`npx tsc --noEmit -p web/tsconfig.json\`**: ${webTsc.status === 0 ? "✅ 0 errors" : "❌ FAILED"}`);
    if (webTsc.status !== 0) {
      const output = (webTsc.stdout || webTsc.stderr || "").trim();
      if (output) results.push("```\n" + output.slice(0, 1000) + "\n```");
    }
  }

  return results.join("\n");
}

/** Run eslint on changed source files locally. */
function runEslintLocally(files, root) {
  const sourceFiles = files.filter(f => f.match(/\.(ts|tsx|js|jsx|mjs)$/));
  if (sourceFiles.length === 0) {
    return "### CQ-1: ESLint (pre-verified locally)\nNo source files to lint.";
  }

  const results = ["### CQ-1: ESLint (pre-verified locally)"];
  let allPassed = true;

  for (const file of sourceFiles) {
    const fullPath = resolve(root, file);
    if (!existsSync(fullPath)) continue;

    const lint = spawnSync("npx", ["eslint", file, "--no-warn-ignored"], {
      cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 30000, shell: true,
    });
    if (lint.status !== 0) {
      allPassed = false;
      const output = (lint.stdout || lint.stderr || "").trim();
      results.push(`- ❌ \`${file}\`: ${output.split("\n")[0]}`);
    }
  }

  if (allPassed) {
    results.push(`✅ All ${sourceFiles.length} files pass eslint.`);
  }

  return results.join("\n");
}

/** Run test commands from evidence locally. */
function runTestsLocally(cmds, root) {
  if (cmds.length === 0) {
    return "### T-1: Tests (pre-verified locally)\nNo test commands found in evidence.";
  }

  const results = ["### T-1: Tests (pre-verified locally)"];

  for (const cmd of cmds) {
    if (cmd.includes("eslint") || cmd.includes("tsc")) continue;

    const parts = cmd.split(/\s+/);
    const child = spawnSync(parts[0], parts.slice(1), {
      cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
      timeout: 120000, shell: true,
    });

    const passed = child.status === 0;
    const output = (child.stdout || child.stderr || "").trim();
    results.push(`**\`${cmd}\`**: ${passed ? "✅ PASS" : "❌ FAIL"}`);
    if (!passed) {
      results.push("```\n" + output.slice(-500) + "\n```");
    } else {
      // Extract summary line (last few lines usually have counts)
      const lines = output.split("\n");
      const summary = lines.slice(-3).join("\n");
      results.push("```\n" + summary + "\n```");
    }
  }

  return results.join("\n");
}

/** Compute changed file list for CC-2. */
function computeChangedFiles(markdown, root) {
  const cwd = root || REPO_ROOT;
  let diffCmd = "git diff --name-only";

  // 1. Extract from evidence — look for explicit diff basis
  const diffBasisRe = /git\s+diff\s+(?:--name-only\s+)?([0-9a-f]{7,40}\.{2,3}[0-9a-f]{7,40})/;
  const match = markdown.match(diffBasisRe);
  if (match) {
    diffCmd = `git diff --name-only ${match[1]}`;
  } else {
    // 2. Compute from git history
    let useMergeBase = false;
    try {
      const mainBranch = (() => {
        const r = spawnSync("git", ["rev-parse", "--verify", "main"], { cwd, stdio: "pipe" });
        return r.status === 0 ? "main" : "master";
      })();
      const mergeBase = spawnSync("git", ["merge-base", "HEAD", mainBranch], {
        cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
      });
      if (mergeBase.status === 0 && mergeBase.stdout.trim()) {
        const base = mergeBase.stdout.trim().slice(0, 10);
        const testCmd = `git diff --name-only ${base}..HEAD`;
        const testResult = spawnSync("git", ["diff", "--name-only", `${base}..HEAD`], {
          cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
        });
        const testFiles = (testResult.stdout || "").trim().split("\n").filter(Boolean);
        if (testFiles.length > 0) {
          diffCmd = testCmd;
          useMergeBase = true;
        }
      }
    } catch { /* merge-base failed */ }

    if (!useMergeBase) {
      try {
        const log = spawnSync("git", ["log", "--oneline", "-10", "--format=%H"], {
          cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
        });
        if (log.status === 0) {
          const hashes = log.stdout.trim().split("\n").filter(Boolean);
          if (hashes.length > 1) {
            const oldest = hashes[hashes.length - 1].slice(0, 10);
            diffCmd = `git diff --name-only ${oldest}..HEAD`;
          }
        }
      } catch { /* fallback failed */ }
    }
  }

  const result = spawnSync("git", diffCmd.replace("git ", "").split(" "), {
    cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  });

  const files = (result.status === 0 ? result.stdout : "").trim().split("\n").filter(Boolean);
  const fileList = files.length > 0
    ? files.map(f => `- \`${f}\``).join("\n")
    : "(no changed files detected)";

  return `**Diff scope** (\`${diffCmd}\`, ${files.length} files):\n${fileList}`;
}

function buildPrompt(scopeText, promotionHint, preVerified, diffScope) {
  const template = readFileSync(promptTemplatePath, "utf8");
  const promotionSection = buildPromotionSection(promotionHint);
  return template
    .split("{{SCOPE}}").join(scopeText)
    .split("{{PRE_VERIFIED}}").join(preVerified)
    .split("{{DIFF_CMD}}").join(diffScope ?? "")
    .split("{{PROMOTION_SECTION}}").join(promotionSection)
    .split("{{CLAUDE_MD_PATH}}").join(claudePath)
    .split("{{GPT_MD_PATH}}").join(gptPath)
    .split("{{TRIGGER_TAG}}").join(cfg.consensus.trigger_tag)
    .split("{{AGREE_TAG}}").join(cfg.consensus.agree_tag)
    .split("{{PENDING_TAG}}").join(cfg.consensus.pending_tag)
    .split("{{DESIGN_DOCS_DIR}}").join(cfg.consensus.design_docs_dir ?? "docs/ko/design/**")
    .split("{{LOCALE}}").join(safeLocale)
    .split("{{REFERENCES_DIR}}").join(
      resolve(HOOKS_DIR, "templates", "references", safeLocale).replace(/\\/g, "/"),
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

function buildCodexArgs(args, resumeTarget, cwd) {
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
    cwd || REPO_ROOT,
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
  if (args.watchFile) {
    respondArgs.push("--watch-file", args.watchFile);
  }
  if (args.autoFix) {
    respondArgs.push("--auto-fix");
  }
  if (!args.pickNext) {
    respondArgs.push("--no-sync-next");
  }

  const respondCwd = args.watchFile ? deriveAuditCwd(args.watchFile) : REPO_ROOT;
  const result = spawnSync(process.execPath, respondArgs, {
    cwd: respondCwd,
    stdio: "inherit",
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    // Do NOT process.exit() — it bypasses .finally() lock cleanup
    console.error(`[audit] respond.mjs exited with code ${result.status}`);
    process.exitCode = result.status ?? 1;
  }
}

/** Derive worktree root from watch_file path. If watch_file is inside a worktree, return that root. */
function deriveAuditCwd(watchFile) {
  if (!watchFile) return REPO_ROOT;
  // Pattern: .../.claude/worktrees/<agent>/docs/feedback/claude.md
  const worktreeMatch = watchFile.replace(/\\/g, "/").match(/(.+\/.claude\/worktrees\/[^/]+)\//);
  if (worktreeMatch) return worktreeMatch[1];
  return REPO_ROOT;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  initPaths(args.watchFile);

  // Resolve audit CWD: if watch_file is in a worktree, Codex must run there
  const auditCwd = deriveAuditCwd(args.watchFile);
  // Session files go to the worktree too (prevents cross-worktree state corruption)
  if (auditCwd !== REPO_ROOT) _sessionDir = resolve(auditCwd, ".claude");

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
  const preVerified = runPreVerification(claudeMd, auditCwd);
  const promotionHint = loadPromotionHint();
  const diffScope = computeChangedFiles(claudeMd, auditCwd);
  let prompt = buildPrompt(scopeText, promotionHint, preVerified, diffScope);

  // Guard: truncate prompt if too large — prevents Codex STATUS_HEAP_CORRUPTION crash
  const MAX_PROMPT_CHARS = 80_000;
  if (prompt.length > MAX_PROMPT_CHARS) {
    console.error(`[audit] Prompt too large (${prompt.length} chars) — truncating to ${MAX_PROMPT_CHARS}`);
    // Keep the audit protocol header + truncated evidence
    const header = prompt.slice(0, 20_000);
    const tail = prompt.slice(-10_000);
    prompt = header + "\n\n⚠️ TRUNCATED: evidence was too large. Review the watch_file directly for full content.\n\n" + tail;
  }

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

  const codexArgs = buildCodexArgs(args, resumeTarget, auditCwd);
  if (args.debugBin) {
    console.log(t("audit.debug_bin", { bin: codexBin }));
  }

  const child = spawnResolvedAsync(codexBin, codexArgs, {
    cwd: auditCwd,
    stdio: ["pipe", "pipe", "pipe"],
  });

  // 프롬프트를 stdin으로 전달 후 닫기
  child.stdin.write(prompt);
  child.stdin.end();

  const { threadId, exitCode } = await streamCodexOutput(child, args.json);

  if (exitCode !== 0) {
    // Do NOT call process.exit() here — it skips .finally() lock cleanup.
    // Instead, write an infra_failure verdict so the worker can proceed.
    const failureVerdict = [
      `## [INFRA_FAILURE]`,
      ``,
      `### Audit Scope`,
      ``,
      `infra_failure: auditor exited with code ${exitCode}. No external review performed.`,
      ``,
      `### Final Verdict`,
      ``,
      `- Status: infra_failure (auditor unreachable)`,
      `- Action: worker unblocked — NOT approved. Requires manual review or retry.`,
      ``,
      `### Execution Metadata`,
      ``,
      `| Field | Value |`,
      `|-------|-------|`,
      `| execution_mode | degraded_infra_failure |`,
      `| audit_status | unreachable |`,
      `| merge_status | provisional |`,
      `| baseline_eligible | false |`,
      ``,
    ].join("\n");
    writeFileSync(gptPath, failureVerdict, "utf8");
    console.error(`[audit] Codex exited with code ${exitCode} — wrote infra_failure verdict to ${gptPath}`);
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

// Lock is per-worktree: if --watch-file is in a worktree, lock goes there too.
const watchFileArg = process.argv.find((a, i) => process.argv[i - 1] === "--watch-file");
const auditLockRoot = watchFileArg ? deriveAuditCwd(watchFileArg) : REPO_ROOT;
const auditLockPath = resolve(auditLockRoot, ".claude", "audit.lock");
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
