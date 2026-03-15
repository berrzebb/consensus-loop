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
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createT } from "./i18n.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");
const cfg = JSON.parse(readFileSync(resolve(__dirname, "config.json"), "utf8"));
const c = cfg.consensus;
const plugin = cfg.plugin;
const t = createT(plugin.locale ?? "en");

const debugLog = resolve(__dirname, plugin.debug_log);
const ackFile  = resolve(__dirname, plugin.ack_file);

function log(msg) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  appendFileSync(debugLog, `[${ts}] ${msg}\n`);
}

function find_watch_file() {
  const name    = c.watch_file.split("/").pop();
  const subPath = c.watch_file.split("/").slice(0, -1).join("/");
  const dirs    = [resolve(__dirname, subPath), resolve(repoRoot, subPath)];
  for (const dir of dirs) {
    for (const v of [name, name.toUpperCase(), name.toLowerCase()]) {
      const p = resolve(dir, v);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

function find_respond_file() {
  const respondName = plugin.respond_file ?? "gpt.md";
  const subPath = c.watch_file.split("/").slice(0, -1).join("/");
  const dirs    = [resolve(__dirname, subPath), resolve(repoRoot, subPath)];
  for (const dir of dirs) {
    for (const v of [respondName, respondName.toUpperCase(), respondName.toLowerCase()]) {
      const p = resolve(dir, v);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

function get_mtime(p) { try { return statSync(p).mtimeMs; } catch { return 0; } }
function read_ack()   { try { return Number(readFileSync(ackFile, "utf8").trim()) || 0; } catch { return 0; } }
function write_ack(ms) { writeFileSync(ackFile, String(ms), "utf8"); }

function has_trigger(content) { return content.includes(c.trigger_tag); }
function has_agreed(content)  { return !content.includes(c.trigger_tag); }

function run_script(absPath, args = []) {
  if (!existsSync(absPath)) { log(`SKIP: ${absPath} not found`); return null; }
  const result = spawnSync(process.execPath, [absPath, ...args], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    env: { ...process.env, FEEDBACK_LOOP_ACTIVE: "1" },
  });
  if (result.error) { log(`ERROR: ${result.error.message}`); return null; }
  const out = (result.stdout || "").trim();
  if (out) log(`OUT: ${out.split("\n")[0]}`);
  return { status: result.status, stdout: out };
}

function read_session_id() {
  const sessionPath = resolve(__dirname, plugin.session_file);
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

  const result = run_script(resolve(__dirname, plugin.audit_script));
  if (!result) { process.stdout.write(t("index.audit.failed")); return; }
  if (result.status !== 0) { process.stdout.write(t("index.audit.exit_abnormal", { code: result.status })); return; }
  if (result.stdout) process.stdout.write(t("index.audit.output", { out: result.stdout }));

  const respondPathNow = find_respond_file();
  if (respondPathNow && existsSync(respondPathNow)) {
    const mtimeAfter     = get_mtime(respondPathNow);
    const content_respond = readFileSync(respondPathNow, "utf8");
    const content_watch  = watchPath ? readFileSync(watchPath, "utf8") : "";
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
    const result = run_script(resolve(__dirname, plugin.respond_script));
    write_ack(Math.max(respondMtime, get_mtime(respondPath)));
    const content_watch = readFileSync(watchPath, "utf8");
    if (result?.stdout) process.stdout.write(t("index.sync.output", { out: result.stdout }));

    if (has_agreed(content_watch)) {
      process.stdout.write(t("index.sync.arrived_agreed", { tag: c.agree_tag }));
    } else {
      const content_respond = readFileSync(respondPath, "utf8");
      process.stdout.write(t("index.sync.arrived_pending", { tag: c.pending_tag, content: content_respond }));
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

    const cmd = rule.command.replace("{file}", filePath.replace(/"/g, '\\"'));
    const result = spawnSync(cmd, {
      cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", shell: true,
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
    if (watchPath && has_trigger(readFileSync(watchPath, "utf8"))) {
      run_audit();
    } else {
      log("EXIT: no trigger_tag");
    }
    return;
  }

  // Planning file changed → gpt-only sync
  if (is_planning_file(normalized)) {
    log("MATCH: planning doc — gpt-only sync");
    if (process.env.FEEDBACK_HOOK_DRY_RUN === "1") {
      process.stdout.write(t("index.dry_run.planning", { script: plugin.respond_script }));
      return;
    }
    const result = run_script(resolve(__dirname, plugin.respond_script), ["--gpt-only"]);
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
