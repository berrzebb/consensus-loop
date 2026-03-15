#!/usr/bin/env node

/**
 * 자동 회고 스크립트.
 *
 * respond.mjs가 모든 감사 항목을 [합의완료]로 닫은 직후 호출됩니다.
 * 1. claude.md에서 최근 합의 완료 항목을 추출하여 맥락으로 제공합니다.
 * 2. retro-prompt.md 템플릿에 맥락을 주입합니다.
 * 3. claude -p로 회고를 실행합니다 (세 가지 질문 답변 + 개선 사항 구현).
 * 4. 회고 블록([GPT미검증] RX-N)이 claude.md에 추가됩니다.
 * 5. audit.mjs를 직접 호출하여 다음 감사 사이클을 시작합니다.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBinary, spawnResolved } from "./cli-runner.mjs";
import { createT } from "./i18n.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");
const cfg = JSON.parse(readFileSync(resolve(__dirname, "config.json"), "utf8"));
const t = createT(cfg.plugin.locale ?? "en");

const claudePathPlugin = resolve(__dirname, cfg.consensus.watch_file);
const claudePathRepo   = resolve(repoRoot, cfg.consensus.watch_file);
const claudePath = existsSync(claudePathPlugin) ? claudePathPlugin : claudePathRepo;

/** 기존 RX-N 항목 수를 세어 다음 ID를 결정합니다. */
function nextRetroId(claudeMd) {
  const matches = claudeMd.match(/\bRX-(\d+)\b/g) ?? [];
  const nums = matches.map((m) => parseInt(m.slice(3), 10));
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  return `RX-${max + 1}`;
}

/** ## 합의완료 앵커 아래의 항목들을 추출합니다. */
function extractAgreedContext(claudeMd, agreedAnchor) {
  const lines = claudeMd.split(/\r?\n/);
  const anchorRe = new RegExp(`^##\\s+${agreedAnchor}\\s*$`);
  const start = lines.findIndex((l) => anchorRe.test(l.trim()));
  if (start < 0) return "(합의 완료 항목 없음)";

  const end = lines.findIndex((l, i) => i > start && /^##\s+/.test(l.trim()));
  const section = (end < 0 ? lines.slice(start + 1) : lines.slice(start + 1, end))
    .filter((l) => l.trim().startsWith("- "))
    .slice(-10); // 최근 10개만

  return section.length > 0 ? section.join("\n") : "(합의 완료 항목 없음)";
}

function buildPrompt(templatePath, rxId, agreedItems) {
  let tpl = readFileSync(templatePath, "utf8");
  tpl = tpl.replace(/\{\{CLAUDE_MD_PATH\}\}/g, claudePath);
  tpl = tpl.replace(/\{\{RX_ID\}\}/g, rxId);
  tpl = tpl.replace(/\{\{AGREED_ITEMS\}\}/g, agreedItems);
  return tpl;
}

function main() {
  if (!existsSync(claudePath)) {
    console.log(t("retro.no_claude_md"));
    return;
  }

  const templatePath = resolve(__dirname, cfg.plugin.retro_prompt ?? "templates/retro-prompt.md");
  if (!existsSync(templatePath)) {
    console.log(t("retro.no_template", { path: templatePath }));
    return;
  }

  const claudeMd = readFileSync(claudePath, "utf8");
  const rxId = nextRetroId(claudeMd);
  const agreedAnchor = cfg.consensus.sections?.agreed_anchor ?? "합의완료";
  const agreedItems = extractAgreedContext(claudeMd, agreedAnchor);
  const prompt = buildPrompt(templatePath, rxId, agreedItems);

  console.log(t("retro.invoking", { rx_id: rxId }));

  // FEEDBACK_LOOP_ACTIVE=1 — claude -p 자식 세션의 훅이 재귀적으로 발화하는 것을 방지합니다.
  const claudeBin = resolveBinary("claude", "CLAUDE_BIN");
  const result = spawnResolved(claudeBin, ["-p"], {
    cwd: repoRoot,
    input: prompt,
    stdio: ["pipe", "inherit", "inherit"],
    env: { ...process.env, FEEDBACK_LOOP_ACTIVE: "1" },
    encoding: "utf8",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.log(t("retro.claude_failed", { code: result.status ?? 1 }));
    return;
  }

  // claude -p 실행 후 RX 항목이 실제로 추가되었는지 확인합니다.
  const claudeMdAfter = existsSync(claudePath) ? readFileSync(claudePath, "utf8") : "";
  if (!claudeMdAfter.includes(rxId)) {
    console.log(t("retro.no_rx_written", { rx_id: rxId }));
    return;
  }

  console.log(t("retro.done", { rx_id: rxId }));

  // 다음 감사 사이클을 즉시 시작합니다.
  const auditScript = resolve(__dirname, cfg.plugin.audit_script ?? "audit.mjs");
  if (existsSync(auditScript)) {
    console.log(t("retro.audit_trigger"));
    const auditResult = spawnResolved(process.execPath, [auditScript], {
      cwd: repoRoot,
      stdio: ["ignore", "inherit", "inherit"],
      encoding: "utf8",
    });
    if (auditResult.error) {
      console.error(`audit failed: ${auditResult.error.message}`);
    }
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`retrospective failed: ${message}`);
  process.exit(1);
}
