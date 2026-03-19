#!/usr/bin/env node
/**
 * Enforcement Smoke Tests — integration tests with realistic file structures.
 *
 * These tests simulate actual production scenarios:
 * - Real handoff format matching session-handoff.md
 * - Real audit-history.jsonl entries matching respond.mjs output
 * - Real evidence format matching evidence-format.md
 * - Real work-catalog format matching planner output
 *
 * Run: node --test tests/enforcement-smoke.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  countTrackPendings,
  blockDownstreamTasks,
  parseResidualRisk,
  appendTechDebt,
  checkFalsePositiveRate,
} from "../scripts/enforcement.mjs";

let tmpDir;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "smoke-"));
});

after(() => {
  if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

// ═══ Smoke 1: Full upstream delay scenario ══════════════════════════════

describe("smoke: upstream delay → downstream block", () => {
  it("simulates 3 rejection rounds then blocks downstream", () => {
    // 1. Create audit history with 3 pending verdicts for PA track
    const historyFile = join(tmpDir, "audit-history.jsonl");
    const entries = [
      { timestamp: "2026-03-19T10:00:00Z", session_id: "s1", track: "PA", req_ids: ["PA-5"], verdict: "pending", rejection_codes: [{ code: "test-gap", severity: "major" }] },
      { timestamp: "2026-03-19T10:30:00Z", session_id: "s1", track: "PA", req_ids: ["PA-5"], verdict: "pending", rejection_codes: [{ code: "scope-mismatch", severity: "major" }] },
      { timestamp: "2026-03-19T11:00:00Z", session_id: "s1", track: "PA", req_ids: ["PA-5"], verdict: "pending", rejection_codes: [{ code: "test-gap", severity: "major" }] },
      // Other track — should not affect PA count
      { timestamp: "2026-03-19T11:00:00Z", session_id: "s1", track: "GW", req_ids: ["GW-1"], verdict: "pending", rejection_codes: [{ code: "lint-gap", severity: "major" }] },
    ];
    writeFileSync(historyFile, entries.map(e => JSON.stringify(e)).join("\n") + "\n");

    // 2. Create realistic handoff matching production format
    const handoffFile = join(tmpDir, "session-handoff.md");
    writeFileSync(handoffFile, `# Session Handoff

## 감사 프로토콜

- RTM 순방향 행이 곧 증거

## 다음 작업

### [PA-5] ArtifactStore extraction
- **status**: correcting
- **depends_on**: —
- **blocks**: GW-1, RP-1
- **agent_id**: a1b2c3

### [GW-1] Gateway direct execution
- **status**: not-started
- **depends_on**: PA
- **blocks**: RP-1

### [RP-1] Role protocol architecture
- **status**: not-started
- **depends_on**: PA, GW
- **blocks**: —

### [EV-1] Evaluation pipeline
- **status**: in-progress
- **depends_on**: OB
- **blocks**: —

## 완료 (이번 세션)

| 작업 | 커밋 | 파일 | 테스트 |
|------|------|------|--------|
| K1 feedback | e4cb43c | 4 | 48 |
`);

    // 3. Verify count
    const pendings = countTrackPendings(historyFile, "PA");
    assert.equal(pendings, 3);

    // 4. Auto-block downstream
    const blocked = blockDownstreamTasks(handoffFile, "PA", `upstream PA rejected ${pendings}x`);
    assert.equal(blocked, 2); // GW-1 and RP-1 depend on PA

    // 5. Verify handoff was updated
    const content = readFileSync(handoffFile, "utf8");
    assert.ok(content.includes("blocked (upstream PA rejected 3x)"), "GW-1 should be blocked");

    // 6. EV-1 should be untouched (depends on OB, not PA)
    const evLine = content.split("\n").find(l => l.includes("[EV-1]"));
    assert.ok(evLine, "EV-1 should still exist");
    const evStatus = content.split("\n").find(l => l.includes("**status**: in-progress") && content.indexOf(l) > content.indexOf("[EV-1]"));
    // EV-1's status should remain in-progress, not blocked
    assert.ok(!content.includes("blocked (upstream PA rejected 3x)\n- **depends_on**: OB"), "EV-1 should not be blocked");
  });
});

// ═══ Smoke 2: Tech debt auto-capture from real evidence ═════════════════

describe("smoke: evidence → tech debt → work-catalog", () => {
  it("extracts residual risk from production-format evidence and appends to catalog", () => {
    // 1. Create realistic evidence matching evidence-format.md
    const evidenceFile = join(tmpDir, "claude.md");
    writeFileSync(evidenceFile, `## [REVIEW_NEEDED] knowledge-retrieval-closure — K1, K4

### Forward RTM Rows

| Req ID | File | Exists | Impl | Test Case | Test Result | Status |
|--------|------|--------|------|-----------|-------------|--------|
| K1 | src/channels/completion-checker.ts | ✅ | ✅ | tests/channel/completion-checker.test.ts | ✓ 20 pass | fixed |
| K4 | src/search/semantic-scorer-port.ts | ✅ | ✅ | tests/search/k4-semantic-scorer.test.ts | ✓ 27 pass | fixed |

### Claim
Implemented K1 completion feedback channel and K4 semantic scorer port.

### Changed Files
**Code:** \`src/channels/completion-checker.ts\`, \`src/search/semantic-scorer-port.ts\`, \`src/search/tool-index.ts\`, \`src/search/skill-index.ts\`
**Tests:** \`tests/channel/completion-checker.test.ts\`, \`tests/search/k4-semantic-scorer.test.ts\`

### Test Command
\`\`\`bash
npx vitest run tests/channel/completion-checker.test.ts tests/search/k4-semantic-scorer.test.ts
npx eslint src/channels/completion-checker.ts src/search/semantic-scorer-port.ts
npx tsc --noEmit
\`\`\`

### Test Result
- vitest: 47 tests passed (20 + 27)
- eslint: passed
- tsc: passed

### Residual Risk
- K1 run-task-loop branch coverage 73.4% < 75% — pre-existing gap, not introduced by this change
- has_role=false default in build_feedback_contract may skip generation in edge cases where team membership is ambiguous
- K4 _last_scores cache not invalidated on index rebuild — stale scores possible after hot reload
`);

    // 2. Parse residual risks
    const evidence = readFileSync(evidenceFile, "utf8");
    const risks = parseResidualRisk(evidence);
    assert.equal(risks.length, 3);
    assert.ok(risks[0].includes("branch coverage"));
    assert.ok(risks[1].includes("has_role"));
    assert.ok(risks[2].includes("_last_scores"));

    // 3. Create realistic work-catalog
    const catalogFile = join(tmpDir, "work-catalog.md");
    writeFileSync(catalogFile, `# Work Catalog

## knowledge-retrieval-closure

| ID | 작업 | Type | Model | Risk | Track |
|----|------|------|-------|------|-------|
| K1 | Completion Feedback Channel | feature | Sonnet | medium | knowledge-retrieval-closure |
| K4 | Semantic Augmentation Port | feature | Sonnet | low | knowledge-retrieval-closure |

## 권장 실행 순서

1. K1 → K4 (K1이 기반 인터페이스 제공)
`);

    // 4. Auto-append tech debt
    const appended = appendTechDebt(catalogFile, risks, "K1+K4");
    assert.equal(appended, 3);

    // 5. Verify catalog was updated with correct format
    const catalog = readFileSync(catalogFile, "utf8");
    assert.ok(catalog.includes("TD-auto"));
    assert.ok(catalog.includes("tech-debt"));
    assert.ok(catalog.includes("K1+K4"));
    assert.ok(catalog.includes("branch coverage"));
    assert.ok(catalog.includes("has_role"));
    assert.ok(catalog.includes("_last_scores"));

    // 6. Verify original content is preserved
    assert.ok(catalog.includes("Completion Feedback Channel"));
    assert.ok(catalog.includes("권장 실행 순서"));

    // 7. Run again — should not duplicate
    const appended2 = appendTechDebt(catalogFile, risks, "K1+K4");
    assert.equal(appended2, 0);
  });
});

// ═══ Smoke 3: False positive detection from realistic history ═══════════

describe("smoke: audit history → false positive detection → retro marker", () => {
  it("detects degraded audit quality from realistic session data", () => {
    const historyFile = join(tmpDir, "history-fp.jsonl");

    // Simulate 8 audit rounds on security-hardening
    // Rounds 1-3: test-gap rejection, round 1-2 are false positives (tests existed but auditor missed)
    // Rounds 4-5: legitimate test-gap (tests actually missing)
    // Rounds 6-8: agree
    const entries = [
      { track: "SH", verdict: "pending", rejection_codes: [{ code: "test-gap", severity: "major", false_positive: true }] },
      { track: "SH", verdict: "pending", rejection_codes: [{ code: "test-gap", severity: "major", false_positive: true }] },
      { track: "SH", verdict: "pending", rejection_codes: [{ code: "test-gap", severity: "major", false_positive: false }] },
      { track: "SH", verdict: "pending", rejection_codes: [{ code: "scope-mismatch", severity: "major", false_positive: false }] },
      { track: "SH", verdict: "pending", rejection_codes: [{ code: "test-gap", severity: "major", false_positive: false }] },
      { track: "SH", verdict: "agree", rejection_codes: [] },
      { track: "SH", verdict: "agree", rejection_codes: [] },
      { track: "SH", verdict: "agree", rejection_codes: [] },
    ];
    writeFileSync(historyFile, entries.map(e => JSON.stringify(e)).join("\n") + "\n");

    // Check: test-gap has 4 occurrences, 2 false positives = 50% FP rate
    const result = checkFalsePositiveRate(historyFile, "SH", 5);
    assert.ok(result.needsReview);
    assert.ok(result.codes.includes("test-gap"));
    // scope-mismatch has 1 occurrence — below 3 threshold, should not be flagged
    assert.ok(!result.codes.includes("scope-mismatch"));
  });

  it("does not flag when audit quality is good", () => {
    const historyFile = join(tmpDir, "history-good.jsonl");

    // 10 rounds, only 1 false positive out of 8 test-gap rejections = 12.5%
    const entries = [];
    for (let i = 0; i < 8; i++) {
      entries.push({ track: "TN", verdict: "pending", rejection_codes: [{ code: "test-gap", severity: "major", false_positive: i === 0 }] });
    }
    entries.push({ track: "TN", verdict: "agree", rejection_codes: [] });
    entries.push({ track: "TN", verdict: "agree", rejection_codes: [] });
    writeFileSync(historyFile, entries.map(e => JSON.stringify(e)).join("\n") + "\n");

    const result = checkFalsePositiveRate(historyFile, "TN", 5);
    assert.ok(!result.needsReview);
  });
});

// ═══ Smoke 4: Dynamic import path verification ═════════════════════════

describe("smoke: enforcement module import", () => {
  it("can be imported from scripts/ directory", async () => {
    const mod = await import("../scripts/enforcement.mjs");
    assert.ok(typeof mod.countTrackPendings === "function");
    assert.ok(typeof mod.blockDownstreamTasks === "function");
    assert.ok(typeof mod.parseResidualRisk === "function");
    assert.ok(typeof mod.appendTechDebt === "function");
    assert.ok(typeof mod.checkFalsePositiveRate === "function");
  });
});
