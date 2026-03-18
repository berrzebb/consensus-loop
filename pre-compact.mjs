#!/usr/bin/env node
/**
 * PreCompact hook: 컨텍스트 압축 전 감사 상태 스냅샷 저장.
 *
 * 압축 후 SessionStart에서 복원하여 감사 사이클 연속성을 보장한다.
 * 저장 대상: retro-marker, audit.lock 존재 여부, 마지막 감사 상태.
 *
 * Fail-open: 모든 에러는 무시하고 stdin을 그대로 통과시킨다.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveRepoRoot() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch { /* fallback */ }
  const legacy = resolve(__dirname, "..", "..", "..");
  if (existsSync(resolve(legacy, ".git"))) return legacy;
  return process.cwd();
}

function loadConfig() {
  const pr = process.env.CLAUDE_PLUGIN_ROOT;
  if (pr) {
    const p = resolve(pr, "config.json");
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  }
  const local = resolve(__dirname, "config.json");
  return existsSync(local) ? JSON.parse(readFileSync(local, "utf8")) : {};
}

try {
  const cfg = loadConfig();

  // Hook toggle — 비활성화 시 스냅샷 생략
  if (cfg.plugin?.hooks_enabled?.pre_compact === false) throw new Error("disabled");

  const REPO_ROOT = resolveRepoRoot();
  const claudeDir = resolve(REPO_ROOT, ".claude");
  const snapshotPath = resolve(claudeDir, "compaction-snapshot.json");

  // 1. retro-marker 상태
  const markerPath = resolve(__dirname, ".session-state", "retro-marker.json");
  let retroMarker = null;
  if (existsSync(markerPath)) {
    try { retroMarker = JSON.parse(readFileSync(markerPath, "utf8")); } catch { /* */ }
  }

  // 2. audit.lock 존재 여부
  const auditInProgress = existsSync(resolve(claudeDir, "audit.lock"));

  // 3. watch_file에서 마지막 감사 상태 라인 추출
  const watchFile = cfg.consensus?.watch_file ?? "docs/feedback/claude.md";
  const watchPath = resolve(REPO_ROOT, watchFile);
  let lastAuditStatus = null;
  if (existsSync(watchPath)) {
    const content = readFileSync(watchPath, "utf8");
    const tags = [
      cfg.consensus?.trigger_tag, cfg.consensus?.agree_tag, cfg.consensus?.pending_tag,
    ].filter(Boolean);
    for (const line of content.split(/\r?\n/)) {
      if (line.startsWith("## ") && tags.some((tag) => line.includes(tag))) {
        lastAuditStatus = line.replace(/^##\s*/, "").trim();
      }
    }
  }

  // 4. 스냅샷 저장
  if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true });
  writeFileSync(snapshotPath, JSON.stringify({
    saved_at: new Date().toISOString(),
    retro_marker: retroMarker,
    audit_in_progress: auditInProgress,
    last_audit_status: lastAuditStatus,
  }, null, 2), "utf8");
} catch {
  // Fail-open: 에러 시 (toggle disabled 포함) 아무 것도 하지 않음
}

// stdin pass-through
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
process.stdout.write(Buffer.concat(chunks));
