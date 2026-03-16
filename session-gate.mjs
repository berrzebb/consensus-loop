#!/usr/bin/env node
/* global process, Buffer */

/**
 * PreToolUse hook: 세션 자가 개선 프로토콜 게이트.
 *
 * 1. 마커 파일 먼저 확인 — retro_pending이 아니면 stdin도 읽지 않고 즉시 종료 (최소 오버헤드)
 * 2. retro_pending일 때만 stdin 파싱 → 도구별 허용/차단 판단
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

// 마커 확인 — retro_pending이 아니면 즉시 종료
const marker = read_marker();
if (!marker || !marker.retro_pending) {
  process.exit(0);
}

// retro_pending일 때만 stdin 읽기
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const raw = Buffer.concat(chunks).toString("utf8").trim();
if (!raw) { process.exit(0); }

let input;
try { input = JSON.parse(raw); } catch { process.exit(0); }

// 세션 독립성: 마커의 session_id와 현재 세션이 다르면 통과
const current_session = input.session_id || "";
if (marker.session_id && current_session && marker.session_id !== current_session) {
  process.exit(0);
}

const tool_name = input.tool_name || "";

// completion 커맨드 → 마커 해제
if (tool_name === "Bash") {
  const command = input.tool_input?.command || "";
  if (command.includes(COMPLETION_CMD)) {
    write_marker({
      retro_pending: false,
      completed_at: new Date().toISOString(),
    });
    process.exit(0);
  }
}

// 메모리 작업용 도구 → 허용
if (ALLOWED_TOOLS.includes(tool_name)) {
  if (!marker.instructions_shown) {
    write_marker({ ...marker, instructions_shown: true });
    const context = marker.agreed_items || "없음";
    process.stdout.write(
      `\n[SESSION SELF-IMPROVEMENT PROTOCOL]\n` +
      `감사 사이클이 완료되었습니다. 커밋 전 회고 프로토콜을 수행하세요.\n\n` +
      `## 합의 완료 항목\n${context}\n\n` +
      `## 수행 절차\n` +
      `1. 회고 — 이번 사이클에서 잘된 것 / 문제인 것\n` +
      `2. 피드백 — 사용자와 양방향 교환\n` +
      `3. 메모리 정리 — 중복/stale 항목 제거\n` +
      `4. 핸드오프 — memory/session_handoff.md에 현재 작업 상태 기록 (진행중/대기/완료)\n` +
      `5. 완료 후: echo session-self-improvement-complete\n\n` +
      `[Bash/Agent 차단 중 — 프로토콜 완료 시 해제]\n`
    );
  }
  process.exit(0);
}

// Bash/Agent 등 → 차단
process.stdout.write(
  `[SESSION GATE] 회고 프로토콜 미완료 — ${tool_name} 차단됨.\n` +
  `Read/Write/Edit로 메모리 정리 후 'echo session-self-improvement-complete'를 실행하세요.\n`
);
process.exit(2);
