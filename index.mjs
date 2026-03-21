#!/usr/bin/env node
/* global process, Buffer */
/**
 * PostToolUse hook: tag-based consensus loop + code quality auto-checks.
 *
 * (A) consensus.watch_file edited + trigger_tag present → run audit_script → wait for agree_tag
 * (B) On any Edit/Write, if the respond file is newer → auto-sync via respond_script
 * (C) quality_rules — run ESLint/npm audit immediately on matching file edits
 *
 * All behavior is controlled by config.json.
 */
import { readFileSync, existsSync, appendFileSync, statSync, writeFileSync, openSync, closeSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync, spawn, execFileSync } from "node:child_process";
import {
  HOOKS_DIR, REPO_ROOT, cfg, plugin, consensus as c,
  findWatchFile, findRespondFile, t, isHookEnabled, configMissing,
} from "../../core/context.mjs";
import * as bridge from "../../core/bridge.mjs";

const debugLog = resolve(HOOKS_DIR, plugin.debug_log ?? "debug.log");
const ackFile  = resolve(HOOKS_DIR, plugin.ack_file ?? "ack.timestamp");

function log(msg) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  appendFileSync(debugLog, `[${ts}] ${msg}\n`);
}

// Use memoized path resolvers from context.mjs
const find_watch_file = findWatchFile;
const find_respond_file = findRespondFile;

/** Pre-validate evidence package format — regex-based, zero tokens. */
function validate_evidence_format(content) {
  const errors = [];
  const warnings = [];
  const triggerSection = content.split(/^## /m).find((s) => s.includes(c.trigger_tag));
  if (!triggerSection) return { errors, warnings };

  // ── Required sections — configurable via consensus.evidence_sections, fallback to defaults ──
  const configSections = c.evidence_sections ?? [];
  const defaultSections = ["Claim", "Changed Files", "Test Command", "Test Result", "Residual Risk"];
  const sectionNames = configSections.length > 0 ? configSections : defaultSections;
  const required = sectionNames.map((label) => ({
    label,
    pattern: new RegExp(`### ${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"),
  }));

  for (const { label, pattern } of required) {
    if (!pattern.test(triggerSection)) {
      errors.push(t("index.format.missing_section", { label }));
    }
  }

  // ── Test Command glob 금지 ──
  if (/### Test Command/.test(triggerSection)) {
    const cmdSection = triggerSection.split(/### Test Command/i)[1]?.split(/### /)[0] || "";
    if (/\*\*?\/|\*\.\w+/.test(cmdSection)) {
      errors.push(t("index.format.glob_in_test"));
    }
  }

  // ── Test Result 비어있는지 ──
  if (/### Test Result/.test(triggerSection)) {
    const resultSection = triggerSection.split(/### Test Result/i)[1]?.split(/### /)[0] || "";
    if (resultSection.trim().length < 10) {
      errors.push(t("index.format.empty_result"));
    }
  }

  // ── 간이 감사: Changed Files 실제 존재 확인 ──
  if (/### Changed Files/.test(triggerSection)) {
    const filesSection = triggerSection.split(/### Changed Files/i)[1]?.split(/### /)[0] || "";
    const listedFiles = [...filesSection.matchAll(/`([^`]+\.[a-zA-Z]+)`/g)].map((m) => m[1]);
    for (const f of listedFiles) {
      const fullPath = resolve(REPO_ROOT, f);
      if (!existsSync(fullPath)) {
        warnings.push(t("index.quick_audit.file_not_found", { file: f }));
      }
    }
    if (listedFiles.length === 0 && filesSection.trim().length > 0) {
      warnings.push(t("index.quick_audit.no_backtick_paths"));
    }
  }

  // ── 간이 감사: git diff와 Changed Files 비교 ──
  if (/### Changed Files/.test(triggerSection)) {
    try {
      const diffFiles = execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: REPO_ROOT, encoding: "utf8" })
        .trim().split("\n").filter(Boolean);
      if (diffFiles.length === 0) {
        // staged 없으면 unstaged 확인
        const unstaged = execFileSync("git", ["diff", "--name-only"], { cwd: REPO_ROOT, encoding: "utf8" })
          .trim().split("\n").filter(Boolean);
        if (unstaged.length > 0) {
          const filesSection = triggerSection.split(/### Changed Files/i)[1]?.split(/### /)[0] || "";
          const listedFiles = [...filesSection.matchAll(/`([^`]+\.[a-zA-Z]+)`/g)].map((m) => m[1]);
          const missing = listedFiles.filter((f) => !unstaged.some((d) => d.endsWith(f) || f.endsWith(d)));
          for (const f of missing) {
            warnings.push(t("index.quick_audit.not_in_diff", { file: f }));
          }
        }
      }
    } catch { /* git 사용 불가 시 무시 */ }
  }

  // ── Quick audit: tag conflict (agree + trigger on same line) ──
  const lines = triggerSection.split(/\r?\n/);
  for (const line of lines) {
    if (line.includes(c.trigger_tag) && line.includes(cfg.consensus.agree_tag)) {
      warnings.push(t("index.quick_audit.tag_conflict", { trigger: c.trigger_tag, agree: cfg.consensus.agree_tag }));
    }
  }

  return { errors, warnings };
}

function get_mtime(p) { try { return statSync(p).mtimeMs; } catch { return 0; } }
function read_ack()   { try { return Number(readFileSync(ackFile, "utf8").trim()) || 0; } catch { return 0; } }
function write_ack(ms) { writeFileSync(ackFile, String(ms), "utf8"); }

function has_trigger(content) { return content.includes(c.trigger_tag); }
function has_agreed(content)  { return !content.includes(c.trigger_tag); }

function run_script(absPath, args = []) {
  if (!existsSync(absPath)) { log(`SKIP: ${absPath} not found`); return null; }
  const result = spawnSync(process.execPath, [absPath, ...args], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    env: { ...process.env, FEEDBACK_LOOP_ACTIVE: "1" },
  });
  if (result.error) { log(`ERROR: ${result.error.message}`); return null; }
  const err = (result.stderr || "").trim();
  if (err) log(`STDERR: ${err.split("\n")[0]}`);
  const out = (result.stdout || "").trim();
  if (out) log(`OUT: ${out.split("\n")[0]}`);
  return { status: result.status, stdout: out };
}

/** (A) Detected trigger_tag → spawn audit_script in background, return immediately. */
function run_audit(watchFilePath) {
  if (process.env.FEEDBACK_HOOK_DRY_RUN === "1") {
    process.stdout.write(t("index.dry_run.audit", { script: plugin.audit_script }));
    return;
  }

  // Derive lock root: if watchFilePath is in a worktree, lock goes there (per-worktree isolation)
  let lockRoot = REPO_ROOT;
  if (watchFilePath) {
    const wMatch = watchFilePath.replace(/\\/g, "/").match(/(.+\/.claude\/worktrees\/[^/]+)\//);
    if (wMatch) lockRoot = wMatch[1];
  }
  const lockPath = resolve(lockRoot, ".claude", "audit.lock");
  const LOCK_TTL_MS = 30 * 60 * 1000; // 30분 — PID 재활용 대비 최대 유효 시간
  if (existsSync(lockPath)) {
    try {
      const lock = JSON.parse(readFileSync(lockPath, "utf8"));
      const age = Date.now() - (lock.startedAt ?? 0);
      if (lock.pid && age < LOCK_TTL_MS) {
        try {
          process.kill(lock.pid, 0);
          process.stdout.write(t("index.audit.already_running", { pid: lock.pid }));
          return;
        } catch {
          log("STALE_LOCK: pid " + lock.pid + " no longer running — removing");
        }
      } else if (age >= LOCK_TTL_MS) {
        log("EXPIRED_LOCK: age " + Math.round(age / 60000) + "min — removing");
      }
    } catch {
      log("INVALID_LOCK: removing corrupt audit.lock");
    }
  }

  const auditScript = resolve(HOOKS_DIR, plugin.audit_script);
  if (!existsSync(auditScript)) {
    log("SKIP: " + auditScript + " not found");
    process.stdout.write(t("index.audit.failed"));
    return;
  }

  // 백그라운드 프로세스로 감사 실행 — 훅 즉시 반환
  const logPath = resolve(lockRoot, ".claude", "audit-bg.log");
  const logFd = openSync(logPath, "w");

  let child;
  try {
    const auditArgs = [auditScript];
    if (watchFilePath) auditArgs.push("--watch-file", watchFilePath);
    child = spawn(process.execPath, auditArgs, {
      cwd: REPO_ROOT,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env, FEEDBACK_LOOP_ACTIVE: "1" },
    });
  } catch (err) {
    closeSync(logFd);
    log("SPAWN_ERROR: " + (err.message ?? err));
    process.stdout.write(t("index.audit.failed"));
    return;
  }

  // spawn 에러 핸들링 (ENOENT 등 — 비동기 에러)
  child.on("error", (err) => {
    log("CHILD_ERROR: " + (err.message ?? err));
    try { rmSync(lockPath, { force: true }); } catch { /* ignore */ }
  });

  writeFileSync(lockPath, JSON.stringify({ pid: child.pid, startedAt: Date.now() }), "utf8");
  child.unref();
  closeSync(logFd);

  log("AUDIT_STARTED: pid=" + child.pid);
  process.stdout.write(t("index.audit.started_async", { tag: c.trigger_tag, pid: child.pid, log: logPath }));
}

/** (B) If the respond file is newer → auto-sync via respond_script. */
function check_pending_response() {
  const respondPath = find_respond_file();
  const watchPath   = find_watch_file();
  if (!respondPath || !watchPath) return;

  const respondMtime = get_mtime(respondPath);
  const watchMtime   = get_mtime(watchPath);
  const lastAck      = read_ack();

  if (respondMtime > watchMtime && respondMtime > lastAck) {
    log("NOTIFY: pending response — auto-sync");
    const result = run_script(resolve(HOOKS_DIR, plugin.respond_script));
    write_ack(Math.max(respondMtime, get_mtime(respondPath)));
    if (result?.stdout) process.stdout.write(t("index.sync.output", { out: result.stdout }));

    try {
      const content_watch = readFileSync(watchPath, "utf8");
      if (has_agreed(content_watch)) {
        process.stdout.write(t("index.sync.arrived_agreed", { tag: c.agree_tag }));
      } else {
        const content_respond = readFileSync(respondPath, "utf8");
        process.stdout.write(t("index.sync.arrived_pending", { tag: c.pending_tag, content: content_respond }));
      }
    } catch (err) {
      log(`WARN: readFileSync failed in check_pending_response: ${err.message}`);
    }
  }
}

/** (C) quality_rules — match file extension/name → run immediate check. */
function run_quality_checks(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  const filename   = filePath.split(/[\\/]/).pop() ?? "";
  if (normalized.includes("/node_modules/")) return;

  // Support both legacy array format and new preset object format
  const qr = cfg.quality_rules;
  const rules = Array.isArray(qr) ? qr : [];

  // If preset format: resolve active presets by detect file presence
  if (qr && !Array.isArray(qr) && Array.isArray(qr.presets)) {
    const activePresets = qr.presets.filter(p => existsSync(resolve(REPO_ROOT, p.detect)));
    for (const preset of activePresets) {
      for (const check of preset.checks ?? []) {
        if (check.per_file) {
          const envRef = process.platform === "win32" ? "%HOOK_TARGET_FILE%" : "$HOOK_TARGET_FILE";
          const cmd = check.command.replace("{file}", envRef);
          const result = spawnSync(cmd, {
            cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", shell: true,
            env: { ...process.env, HOOK_TARGET_FILE: filePath },
          });
          const output = ((result.stdout || "") + (result.stderr || "")).trim();
          if (result.status !== 0 && output && !check.optional) {
            process.stdout.write(t("index.check.error", { label: check.label, file: filename, output }));
          }
        }
      }
    }
    return;
  }

  // Legacy array format
  for (const rule of rules) {
    const m = rule.match;
    if (m.extension && !normalized.endsWith(m.extension)) continue;
    if (m.path_contains && !m.path_contains.some((p) => normalized.includes(p))) continue;
    if (m.filenames && !m.filenames.includes(filename)) continue;

    const envRef = process.platform === "win32" ? "%HOOK_TARGET_FILE%" : "$HOOK_TARGET_FILE";
    const cmd = rule.command.replace("{file}", envRef);
    const result = spawnSync(cmd, {
      cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", shell: true,
      env: { ...process.env, HOOK_TARGET_FILE: filePath },
    });
    const output = ((result.stdout || "") + (result.stderr || "")).trim();
    if (result.status !== 0 && output) {
      process.stdout.write(t("index.check.error", { label: rule.label, file: filename, output }));
    }
  }
}

function is_planning_file(normalized) {
  const files = c.planning_files ?? [];
  const dirs  = c.planning_dirs  ?? [];
  return files.some((f) => normalized.endsWith(f.replace(/\\/g, "/")))
    || dirs.some((d) => normalized.includes(d.replace(/\\/g, "/")));
}

async function main() {
  log("Hook triggered");
  if (configMissing) {
    process.stdout.write("[quorum] config.json not found. Run a new session to trigger auto-setup, or see README.md for manual configuration.");
    return;
  }
  if (process.env.FEEDBACK_LOOP_ACTIVE === "1") { log("EXIT: reentrant"); return; }

  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) { log("EXIT: empty stdin"); return; }

  let payload;
  try { payload = JSON.parse(raw); } catch {
    log("EXIT: JSON parse error");
    check_pending_response();
    return;
  }

  // Propagate session_id via env — downstream scripts (retrospective.mjs) record it in markers
  const sessionId = payload?.session_id || "";
  if (sessionId) {
    process.env.RETRO_SESSION_ID = sessionId;
  }

  const toolName = String(payload?.tool_name ?? "unknown");
  const filePath = String(payload?.tool_input?.file_path ?? "");
  log(`tool=${toolName} file_path=${filePath}`);
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();

  // (C) Code quality immediate check (skip consensus watch_file)
  if (isHookEnabled("quality_rules") && !normalized.endsWith(c.watch_file.toLowerCase())) {
    run_quality_checks(filePath);
  }

  // (A) Detect watch_file edit — with debounce for sequential edits
  if (isHookEnabled("audit") && normalized.endsWith(c.watch_file.toLowerCase())) {
    // Use the actual file_path from tool input — not findWatchFile() which only checks main repo.
    // This ensures worktree watch_file edits are detected correctly.
    const watchPath = existsSync(filePath) ? filePath : find_watch_file();
    if (!watchPath) { log("EXIT: watch_file not found"); return; }

    const content = readFileSync(watchPath, "utf8");
    if (!has_trigger(content)) { log("EXIT: no trigger_tag"); return; }

    // Derive worktree root for debounce isolation
    let debounceRoot = REPO_ROOT;
    const wm = watchPath.replace(/\\/g, "/").match(/(.+\/.claude\/worktrees\/[^/]+)\//);
    if (wm) debounceRoot = wm[1];

    // 디바운스: 연속 Edit 시 마지막 Edit만 감사 트리거 (per-worktree)
    const DEBOUNCE_MS = 10_000;
    const debouncePath = resolve(debounceRoot, ".claude", "audit-debounce.ts");
    const now = Date.now();
    writeFileSync(debouncePath, String(now), "utf8");
    log(`DEBOUNCE: scheduled at ${now}, waiting ${DEBOUNCE_MS}ms`);

    await new Promise((r) => setTimeout(r, DEBOUNCE_MS));

    // 디바운스 확인: 내가 쓴 timestamp가 아직 유효한가?
    try {
      const current = readFileSync(debouncePath, "utf8").trim();
      if (current !== String(now)) {
        log(`DEBOUNCE: superseded by ${current}, skipping`);
        return;
      }
    } catch {
      log("DEBOUNCE: file removed, skipping");
      return;
    }

    // 디바운스 통과 — 마지막 Edit 확인. 최신 content 다시 읽기.
    const freshContent = readFileSync(watchPath, "utf8");
    if (!has_trigger(freshContent)) { log("EXIT: trigger_tag removed during debounce"); return; }

    // Pre-validate format + 간이 감사 — zero tokens, blocks before Codex invocation
    const { errors: formatErrors, warnings: quickAuditWarnings } = validate_evidence_format(freshContent);
    if (formatErrors.length > 0) {
      const errorList = formatErrors.map((e) => `  • ${e}`).join("\n");
      process.stdout.write(t("index.format.check_header", { errors: errorList }));
      log(`FORMAT_INCOMPLETE: ${formatErrors.length} errors`);
      return;
    }

    // 간이 감사 결과 출력 (warning은 감사를 차단하지 않음 — 참고용)
    if (quickAuditWarnings.length > 0) {
      const warnList = quickAuditWarnings.map((w) => `  ⚠ ${w}`).join("\n");
      process.stdout.write(t("index.quick_audit.header", { count: quickAuditWarnings.length, warnings: warnList }));
      log(`QUICK_AUDIT: ${quickAuditWarnings.length} warnings`);
    }

    // ── Bridge: evaluate trigger + emit events ──
    const bridgeReady = await bridge.init(REPO_ROOT);
    if (bridgeReady) {
      // Count changed files from evidence
      const changedFileSection = freshContent.match(/### Changed Files[\s\S]*?(?=###|$)/)?.[0] ?? "";
      const changedFileCount = (changedFileSection.match(/^- `/gm) ?? []).length;

      // Check prior rejections
      const priorRejections = bridge.queryEvents({ eventType: "audit.verdict" })
        .filter((e) => e.payload.verdict === "changes_requested").length;

      const triggerResult = bridge.evaluateTrigger({
        changedFiles: changedFileCount || 1,
        securitySensitive: /auth|token|secret|crypt/i.test(changedFileSection),
        priorRejections,
        apiSurfaceChanged: /api|endpoint|route/i.test(changedFileSection),
        crossLayerChange: changedFileSection.includes("src/") && changedFileSection.includes("tests/"),
        isRevert: /revert|rollback/i.test(freshContent),
      });

      if (triggerResult) {
        log(`TRIGGER: mode=${triggerResult.mode} tier=${triggerResult.tier} score=${triggerResult.score.toFixed(2)}`);
        bridge.emitEvent("audit.submit", "claude-code", {
          file: watchPath,
          tier: triggerResult.tier,
          mode: triggerResult.mode,
          score: triggerResult.score,
          reasons: triggerResult.reasons,
        }, { sessionId });

        // T1 skip: no audit needed — unless minimum_tier overrides
        const minTier = cfg.experiment?.minimum_tier ?? 0;
        if (triggerResult.mode === "skip" && minTier < 2) {
          log("SKIP: T1 micro change — no audit needed");
          process.stdout.write(`[quorum] T1 micro change (score: ${triggerResult.score.toFixed(2)}) — audit skipped.\n`);
          bridge.close();
          return;
        }
        if (triggerResult.mode === "skip" && minTier >= 2) {
          log(`OVERRIDE: T1 would skip, but minimum_tier=${minTier} forces audit`);
          process.stdout.write(`[quorum] minimum_tier=${minTier} — T1 skip overridden, audit forced.\n`);
        }
      }

      // Check stagnation before spawning audit
      const stagnation = bridge.detectStagnation(REPO_ROOT);
      if (stagnation?.detected) {
        log(`STAGNATION: ${stagnation.patterns.map((p) => p.type).join(",")} → ${stagnation.recommendation}`);
        bridge.emitEvent("quality.fail", "claude-code", {
          stagnation: true,
          patterns: stagnation.patterns.map((p) => p.type),
          recommendation: stagnation.recommendation,
        }, { sessionId });
      }
    }

    run_audit(watchPath);
    if (bridgeReady) bridge.close();
    return;
  }

  // Planning file changed → gpt-only sync
  if (is_planning_file(normalized)) {
    log("MATCH: planning doc — gpt-only sync");
    if (process.env.FEEDBACK_HOOK_DRY_RUN === "1") {
      process.stdout.write(t("index.dry_run.planning", { script: plugin.respond_script }));
      return;
    }
    const result = run_script(resolve(HOOKS_DIR, plugin.respond_script), ["--gpt-only"]);
    if (result?.stdout) process.stdout.write(t("index.planning.sync", { out: result.stdout }));
    write_ack(Date.now());
    return;
  }

  // (B) Other file edited → check for pending response
  check_pending_response();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => log(`FATAL: ${err.message}`));
}

export { find_respond_file };
