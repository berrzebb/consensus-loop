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
import { readFileSync, existsSync, appendFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  HOOKS_DIR, REPO_ROOT, cfg, plugin, consensus as c,
  findWatchFile, findRespondFile, t,
} from "./context.mjs";

const debugLog = resolve(HOOKS_DIR, plugin.debug_log);
const ackFile  = resolve(HOOKS_DIR, plugin.ack_file);

function log(msg) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  appendFileSync(debugLog, `[${ts}] ${msg}\n`);
}

// 경로 해석은 context.mjs의 메모이제이션된 findWatchFile/findRespondFile 사용
const find_watch_file = findWatchFile;
const find_respond_file = findRespondFile;

/** 증거 패키지 형식 사전 검증 — 정규식 기반, 토큰 0. */
function validate_evidence_format(content) {
  const errors = [];
  const triggerSection = content.split(/^## /m).find((s) => s.includes(c.trigger_tag));
  if (!triggerSection) return errors; // trigger 섹션 자체가 없으면 검증 대상 아님

  const required = [
    { label: "Claim", pattern: /### Claim/i },
    { label: "Changed Files", pattern: /### Changed Files/i },
    { label: "Test Command", pattern: /### Test Command/i },
    { label: "Test Result", pattern: /### Test Result/i },
    { label: "Residual Risk", pattern: /### Residual Risk/i },
  ];

  for (const { label, pattern } of required) {
    if (!pattern.test(triggerSection)) {
      errors.push(`[FORMAT_MISSING_SECTION] '### ${label}' 섹션이 없습니다.`);
    }
  }

  // Test Command에 glob 사용 여부
  if (/### Test Command/.test(triggerSection)) {
    const cmdSection = triggerSection.split(/### Test Command/i)[1]?.split(/### /)[0] || "";
    if (/\*\*?\/|\*\.\w+/.test(cmdSection)) {
      errors.push("[FORMAT_GLOB_IN_TEST] Test Command에 glob 패턴이 포함되어 있습니다. 명시적 파일 목록을 사용하세요.");
    }
  }

  // Test Result가 비어있는지
  if (/### Test Result/.test(triggerSection)) {
    const resultSection = triggerSection.split(/### Test Result/i)[1]?.split(/### /)[0] || "";
    if (resultSection.trim().length < 10) {
      errors.push("[FORMAT_EMPTY_RESULT] Test Result가 비어있거나 너무 짧습니다. 터미널 출력을 복붙하세요.");
    }
  }

  return errors;
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

function read_session_id() {
  const sessionPath = resolve(HOOKS_DIR, plugin.session_file);
  try {
    const stored = JSON.parse(readFileSync(sessionPath, "utf8"));
    return stored.id || null;
  } catch { return null; }
}

/** (A) Detected trigger_tag → run audit_script → emit result. */
function run_audit() {
  if (process.env.FEEDBACK_HOOK_DRY_RUN === "1") {
    process.stdout.write(t("index.dry_run.audit", { script: plugin.audit_script }));
    return;
  }
  const sessionId = read_session_id();
  const mode = sessionId
    ? t("index.session.resume", { id: sessionId.slice(0, 8) })
    : t("index.session.new");
  process.stdout.write(t("index.trigger.detected", { tag: c.trigger_tag, mode }));

  const watchPath   = find_watch_file();
  const respondPath = find_respond_file();
  const mtimeBefore = respondPath ? get_mtime(respondPath) : 0;

  const result = run_script(resolve(HOOKS_DIR, plugin.audit_script));
  if (!result) { process.stdout.write(t("index.audit.failed")); return; }
  if (result.status !== 0) { process.stdout.write(t("index.audit.exit_abnormal", { code: result.status })); return; }
  if (result.stdout) process.stdout.write(t("index.audit.output", { out: result.stdout }));

  const respondPathNow = find_respond_file();
  if (respondPathNow && existsSync(respondPathNow)) {
    const mtimeAfter     = get_mtime(respondPathNow);
    let content_respond = readFileSync(respondPathNow, "utf8");
    const content_watch  = watchPath ? readFileSync(watchPath, "utf8") : "";

    // 감사 완료 타임스탬프를 gpt.md 하단에 시스템적으로 추가
    const ts = new Date().toISOString().replace("T", " ").slice(0, 16);
    const tsLine = `\n---\n> 감사 완료: ${ts}\n`;
    if (!content_respond.includes(`감사 완료: ${ts}`)) {
      // 기존 타임스탬프 라인 제거 후 새 타임스탬프 추가
      content_respond = content_respond.replace(/\n---\n> 감사 완료: .+\n/g, "");
      content_respond = content_respond.trimEnd() + tsLine;
      writeFileSync(respondPathNow, content_respond, "utf8");
    }

    write_ack(Date.now());

    if (has_agreed(content_watch)) {
      const key = mtimeAfter > mtimeBefore ? "index.audit.done_agreed_updated" : "index.audit.done_agreed";
      process.stdout.write(t(key, { tag: c.agree_tag, content: content_respond }));
    } else {
      process.stdout.write(t("index.audit.done_pending", { tag: c.pending_tag, content: content_respond }));
    }
  }
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

  for (const rule of cfg.quality_rules ?? []) {
    const m = rule.match;
    if (m.extension && !normalized.endsWith(m.extension)) continue;
    if (m.path_contains && !m.path_contains.some((p) => normalized.includes(p))) continue;
    if (m.filenames && !m.filenames.includes(filename)) continue;
    if (normalized.includes("/node_modules/")) continue;

    // Shell injection 방지: filePath를 환경변수로 전달하여 쉘 메타문자 무력화
    const cmd = rule.command.replace("{file}", "$HOOK_TARGET_FILE");
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

  // session_id를 env로 전파 — 하위 스크립트(retrospective.mjs)가 마커에 기록
  const sessionId = payload?.session_id || "";
  if (sessionId) {
    process.env.RETRO_SESSION_ID = sessionId;
  }

  const filePath = String(payload?.tool_input?.file_path ?? "");
  log(`file_path=${filePath}`);
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();

  // (C) Code quality immediate check (skip consensus watch_file)
  if (!normalized.endsWith(c.watch_file.toLowerCase())) {
    run_quality_checks(filePath);
  }

  // (A) Detect watch_file edit
  if (normalized.endsWith(c.watch_file.toLowerCase())) {
    const watchPath = find_watch_file();
    if (!watchPath) { log("EXIT: watch_file not found"); return; }

    const content = readFileSync(watchPath, "utf8");
    if (!has_trigger(content)) { log("EXIT: no trigger_tag"); return; }

    // 형식 사전 검증 — 토큰 0, Codex 호출 전 차단
    const formatErrors = validate_evidence_format(content);
    if (formatErrors.length > 0) {
      const errorList = formatErrors.map((e) => `  • ${e}`).join("\n");
      process.stdout.write(
        `\n[FORMAT-CHECK] 증거 패키지 형식 오류 — 감사를 건너뜁니다.\n` +
        `아래 항목을 보충한 후 다시 제출하세요:\n\n${errorList}\n\n` +
        `에러 코드: FORMAT_INCOMPLETE\n`
      );
      log(`FORMAT_INCOMPLETE: ${formatErrors.length} errors`);
      return;
    }

    run_audit();
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
