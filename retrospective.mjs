#!/usr/bin/env node
/* global process, console */

/**
 * 감사 사이클 완료 후 회고 마커를 설정.
 *
 * respond.mjs에서 모든 감사 항목이 [합의완료]일 때 호출됨.
 * 기존: claude -p로 외부 에이전트 실행 (HITL 불가, 통제 불가)
 * 변경: 마커 파일만 작성 → session-gate.mjs가 메인 세션에서 회고 강제 (HITL 가능)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createT } from "./i18n.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");
const cfg = JSON.parse(readFileSync(resolve(__dirname, "config.json"), "utf8"));
const t = createT(cfg.plugin.locale ?? "en");

const MARKER_DIR = resolve(__dirname, ".session-state");
const MARKER_PATH = resolve(MARKER_DIR, "retro-marker.json");

const claudePathPlugin = resolve(__dirname, cfg.consensus.watch_file);
const claudePathRepo   = resolve(repoRoot, cfg.consensus.watch_file);
const claudePath = existsSync(claudePathPlugin) ? claudePathPlugin : claudePathRepo;

/** RX-N 시퀀스 다음 번호 산출. */
function nextRetroId(claudeMd) {
  const matches = claudeMd.match(/\bRX-(\d+)\b/g) ?? [];
  const nums = matches.map((m) => parseInt(m.slice(3), 10));
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  return `RX-${max + 1}`;
}

/** 합의완료 섹션에서 최근 항목 추출. */
function extractAgreedContext(claudeMd, agreedAnchor) {
  const lines = claudeMd.split(/\r?\n/);
  const anchorRe = new RegExp(`^##\\s+${agreedAnchor}\\s*$`);
  const start = lines.findIndex((l) => anchorRe.test(l.trim()));
  if (start < 0) return t("retro.no_agreed_items");

  const end = lines.findIndex((l, i) => i > start && /^##\s+/.test(l.trim()));
  const section = (end < 0 ? lines.slice(start + 1) : lines.slice(start + 1, end))
    .filter((l) => l.trim().startsWith("- "))
    .slice(-10);

  return section.length > 0 ? section.join("\n") : t("retro.no_agreed_items");
}

function main() {
  if (!existsSync(claudePath)) {
    console.log(t("retro.no_claude_md"));
    return;
  }

  const claudeMd = readFileSync(claudePath, "utf8");
  const rxId = nextRetroId(claudeMd);
  const agreedAnchor = cfg.consensus.sections?.agreed_anchor ?? "합의완료";
  const agreedItems = extractAgreedContext(claudeMd, agreedAnchor);

  // 마커 파일 작성 — session-gate.mjs가 다음 PreToolUse에서 감지
  // session_id는 index.mjs → respond.mjs → retrospective.mjs로 env 전파됨
  const sessionId = process.env.RETRO_SESSION_ID || null;
  if (!existsSync(MARKER_DIR)) mkdirSync(MARKER_DIR, { recursive: true });
  writeFileSync(MARKER_PATH, JSON.stringify({
    retro_pending: true,
    session_id: sessionId,
    rx_id: rxId,
    agreed_items: agreedItems,
    instructions_shown: false,
    created_at: new Date().toISOString(),
  }, null, 2), "utf8");

  console.log(t("retro.marker_set", { rx_id: rxId }));
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`retrospective marker failed: ${message}`);
  process.exit(1);
}
