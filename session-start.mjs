#!/usr/bin/env node
/**
 * Hook: SessionStart
 * Loads handoff + recent changes + audit state as context for new sessions.
 * Detects interrupted audit cycles and orchestrator tracks → provides resume instructions.
 */
import { readFileSync, existsSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { syncHandoffFromMemory } from "./handoff-writer.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveRepoRoot() {
  try {
    return execSync("git rev-parse --show-toplevel", { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch { /* git unavailable */ }
  const legacy = resolve(__dirname, "..", "..", "..");
  if (existsSync(resolve(legacy, ".git"))) return legacy;
  return process.cwd();
}
const REPO_ROOT = resolveRepoRoot();

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
const configPath = (() => {
  if (pluginRoot) {
    const p = resolve(pluginRoot, "config.json");
    if (existsSync(p)) return p;
  }
  return resolve(__dirname, "config.json");
})();
const cfg = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};
const watchFile = cfg.consensus?.watch_file ?? "docs/feedback/claude.md";
const respondFile = cfg.plugin?.respond_file ?? "gpt.md";
const triggerTag = cfg.consensus?.trigger_tag ?? "[GPT미검증]";
const agreeTag = cfg.consensus?.agree_tag ?? "[합의완료]";
const pendingTag = cfg.consensus?.pending_tag ?? "[계류]";

let context = "";
const resumeActions = [];

// ── 0. Handoff sync ─────────────────────────────────────────
const handoffFile = cfg.plugin?.handoff_file ?? ".claude/session-handoff.md";
try {
  syncHandoffFromMemory(REPO_ROOT, handoffFile);
} catch { /* non-fatal */ }

// ── 1. Session handoff ──────────────────────────────────────
const handoff = resolve(REPO_ROOT, handoffFile);
let handoffContent = "";
if (existsSync(handoff)) {
  handoffContent = readFileSync(handoff, "utf8").trim();
  if (handoffContent) context += `Session Handoff:\n${handoffContent}\n\n`;
}

// ── 2. Recent git commits ───────────────────────────────────
try {
  const commits = execSync("git log --oneline -10", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  if (commits) context += `Recent commits:\n${commits}\n\n`;
} catch { /* git unavailable */ }

// ── 3. Resume detection ─────────────────────────────────────
// 3a. Audit lock — stale process detection + cleanup
const auditLock = resolve(REPO_ROOT, ".claude", "audit.lock");
if (existsSync(auditLock)) {
  let lockCleanedUp = false;
  try {
    const lock = JSON.parse(readFileSync(auditLock, "utf8"));
    const ageMin = Math.round((Date.now() - (lock.startedAt ?? 0)) / 60000);

    // PID liveness check
    let pidAlive = false;
    if (lock.pid) {
      try { process.kill(lock.pid, 0); pidAlive = true; } catch { /* dead */ }
    }

    if (!pidAlive) {
      // 프로세스 사망 — 락 정리 + 재개 안내
      rmSync(auditLock, { force: true });
      lockCleanedUp = true;
      resumeActions.push(
        `감사 프로세스(PID ${lock.pid ?? "?"})가 ${ageMin}분 전 시작 후 종료됨. audit.lock 자동 정리 완료.`
        + `\n  → watch_file의 ${triggerTag} 상태를 확인하고 필요 시 증거를 재제출하세요.`
      );
    } else {
      context += `⚠ Background audit in progress (PID ${lock.pid}, ${ageMin}min ago)\n`;
    }
  } catch {
    // 손상된 락 파일 — 정리
    rmSync(auditLock, { force: true });
    lockCleanedUp = true;
    resumeActions.push("손상된 audit.lock 정리됨. 감사 상태를 확인하세요.");
  }
}

// 3b. Watch file + GPT response → 감사 사이클 상태 판단
const watchPath = resolve(REPO_ROOT, watchFile);
const watchDir = resolve(REPO_ROOT, watchFile, "..");
const gptMd = resolve(watchDir, respondFile);
let watchContent = "";
let gptContent = "";

if (existsSync(watchPath)) {
  watchContent = readFileSync(watchPath, "utf8");
}
if (existsSync(gptMd)) {
  gptContent = readFileSync(gptMd, "utf8");
}

if (watchContent) {
  const hasTrigger = watchContent.includes(triggerTag);
  const hasPending = gptContent.includes(pendingTag);
  const hasAgreed = gptContent.includes(agreeTag);

  if (hasPending && hasTrigger) {
    // pending_tag 보정이 필요한 상태 — 가장 일반적인 resume 케이스
    // gpt.md에서 반려 코드 추출
    const rejectionCodes = [];
    for (const line of gptContent.split(/\r?\n/)) {
      const codeMatch = line.match(/`([\w-]+)\s*\[(major|minor|critical)\]`/);
      if (codeMatch) rejectionCodes.push(`${codeMatch[1]} [${codeMatch[2]}]`);
    }
    resumeActions.push(
      `${pendingTag} 보정이 필요합니다.`
      + (rejectionCodes.length > 0 ? `\n  반려 코드: ${rejectionCodes.join(", ")}` : "")
      + `\n  → gpt.md의 보정 항목을 확인하고 코드를 수정한 뒤 증거를 재제출하세요.`
      + `\n  → 파일: ${watchFile} (${triggerTag} 유지)`
    );
  } else if (hasTrigger && !hasPending && !hasAgreed && !existsSync(auditLock)) {
    // trigger_tag 있지만 감사 결과 없음 — 감사가 실행되지 않았거나 실패
    resumeActions.push(
      `${triggerTag} 증거가 제출되었으나 감사 결과가 없습니다.`
      + `\n  → 감사가 실행되지 않았거나 실패했을 수 있습니다. 증거를 재제출하세요.`
    );
  } else if (hasAgreed && !hasTrigger) {
    context += `Current audit status: ${agreeTag} — 합의 완료 상태\n`;
  }
}

// 3c. Retrospective state
const retroMarker = resolve(__dirname, ".session-state", "retro-marker.json");
if (existsSync(retroMarker)) {
  try {
    const marker = JSON.parse(readFileSync(retroMarker, "utf8"));
    if (marker.retro_pending && marker.deferred_to_orchestrator) {
      resumeActions.push(
        `서브에이전트 회고가 orchestrator에 위임됨 (${marker.rx_id ?? "unknown"}).`
        + `\n  → 즉시 회고를 시작하세요:`
        + `\n    1. 잘된 것 / 문제인 것 / 개선할 것`
        + `\n    2. 사용자와 피드백 교환`
        + `\n    3. 메모리에 원칙 기록`
        + `\n    4. echo session-self-improvement-complete`
        + (marker.agreed_items ? `\n  합의된 항목:\n${marker.agreed_items}` : "")
      );
    } else if (marker.retro_pending) {
      resumeActions.push(
        `회고가 미완료 (${marker.rx_id ?? "unknown"}). session-gate가 Bash/Agent를 차단합니다.`
        + `\n  → 즉시 회고를 진행한 뒤 echo session-self-improvement-complete`
      );
    }
  } catch { /* marker parse error */ }
}

// 3d. Orchestrator track detection from handoff
if (handoffContent) {
  const inProgressTracks = [];
  const blockedTracks = [];
  for (const line of handoffContent.split(/\r?\n/)) {
    // "- **상태**: 진행 중" 또는 "**status**: in_progress" 패턴
    if (/진행\s*중|in.?progress/i.test(line)) {
      // 이전 줄에서 작업 제목 추출 시도
      inProgressTracks.push(line.trim());
    }
    if (/blocked/i.test(line)) {
      blockedTracks.push(line.trim());
    }
  }

  // ### [task-id] 형식의 작업 항목에서 "진행 중" 상태인 것 추출
  const taskBlocks = handoffContent.split(/(?=^### \[)/m);
  const activeTasks = [];
  for (const block of taskBlocks) {
    const titleMatch = block.match(/^### \[([^\]]+)\]\s*(.+)/m);
    if (!titleMatch) continue;
    const statusMatch = block.match(/\*\*상태\*\*:\s*(.+)/);
    if (!statusMatch) continue;
    const status = statusMatch[1].trim();
    if (/진행\s*중|in.?progress/i.test(status)) {
      activeTasks.push({ id: titleMatch[1], title: titleMatch[2].trim(), status });
    }
  }

  if (activeTasks.length > 0) {
    const taskList = activeTasks.map((t) => `  - [${t.id}] ${t.title}`).join("\n");
    resumeActions.push(
      `이전 세션에서 ${activeTasks.length}개 작업이 진행 중이었습니다:`
      + `\n${taskList}`
      + `\n  → /consensus-loop:orchestrator 로 미완료 트랙을 이어서 진행하세요.`
    );
  }
}

// 3e. Compaction snapshot
const snapshotPath = resolve(REPO_ROOT, ".claude", "compaction-snapshot.json");
if (existsSync(snapshotPath)) {
  try {
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    const parts = [];
    if (snapshot.audit_in_progress) parts.push("감사 진행 중");
    if (snapshot.last_audit_status) parts.push(`마지막 항목: ${snapshot.last_audit_status}`);
    if (snapshot.retro_marker?.retro_pending) parts.push("회고 대기");
    if (parts.length > 0) {
      context += `[Pre-compaction state — ${snapshot.saved_at}] ${parts.join(", ")}\n`;
    }
  } catch { /* snapshot parse error */ }
}

// ── 4. Build resume context ─────────────────────────────────
if (resumeActions.length > 0) {
  context += `\n${"=".repeat(50)}\n`;
  context += `[RESUME REQUIRED — ${resumeActions.length} action(s)]\n`;
  context += `${"=".repeat(50)}\n\n`;
  for (let i = 0; i < resumeActions.length; i++) {
    context += `${i + 1}. ${resumeActions[i]}\n\n`;
  }
}

// ── 5. Context Reinforcement ────────────────────────────────
// 컨텍스트 압축 후에도 핵심 프로토콜 규칙이 유지되도록 매 세션 시작 시 재주입.
// AI-GUIDE.md의 "절대 규칙" 섹션을 동적으로 읽어서 주입 (Policy as Data).
const locale = cfg.plugin?.locale ?? "en";
const guideDir = (() => {
  const pr = process.env.CLAUDE_PLUGIN_ROOT ?? __dirname;
  const p = resolve(pr, "docs", locale, "AI-GUIDE.md");
  if (existsSync(p)) return p;
  // fallback: try the other locale
  const fb = locale === "ko" ? "en" : "ko";
  const p2 = resolve(pr, "docs", fb, "AI-GUIDE.md");
  if (existsSync(p2)) return p2;
  return null;
})();

if (guideDir) {
  try {
    const guideContent = readFileSync(guideDir, "utf8");
    // "## 절대 규칙" 또는 "## Absolute Rules" 섹션 추출
    const sectionMatch = guideContent.match(
      /^(## (?:절대 규칙|Absolute Rules)\s*\n(?:(?!^## ).+\n)*)/m
    );
    if (sectionMatch) {
      const rules = sectionMatch[1].trim();
      context += `\n<CONTEXT-REINFORCEMENT>\n`;
      context += `${rules}\n`;
      context += `\n증거 제출 전 /consensus-loop:verify 필수. 자기 승격(${agreeTag}) 절대 금지.\n`;
      context += `</CONTEXT-REINFORCEMENT>\n`;
    }
  } catch { /* AI-GUIDE read error — non-fatal */ }
}

// ── Output ──────────────────────────────────────────────────
if (context) {
  const escaped = JSON.stringify(context);
  process.stdout.write(`{"additionalContext": ${escaped}}`);
}
