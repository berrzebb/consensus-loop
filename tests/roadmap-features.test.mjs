#!/usr/bin/env node
/**
 * Roadmap Features Tests — structural enforcement (not protocol suggestions)
 *
 * Tests:
 *   1. Upstream Delay Notification — 3+ pending on same track → downstream auto-blocked
 *   2. Rejection Code Improvement — false positive rate threshold → policy_review flag
 *   3. Technical Debt Tracking — Residual Risk parsing → work-catalog auto-append
 *
 * Run: node --test tests/roadmap-features.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tmpDir;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "roadmap-test-"));
});

after(() => {
  if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

// ═══ Helper: count pending verdicts for a track in audit history ════════

function countTrackPendings(historyPath, track) {
  if (!existsSync(historyPath)) return 0;
  const lines = readFileSync(historyPath, "utf8").split(/\r?\n/).filter(l => l.trim());
  let count = 0;
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.track === track && entry.verdict === "pending") count++;
    } catch { /* skip malformed */ }
  }
  return count;
}

// ═══ Helper: update downstream tasks in handoff when upstream is delayed ═

function blockDownstreamTasks(handoffPath, blockedTrack, reason) {
  if (!existsSync(handoffPath)) return 0;
  let content = readFileSync(handoffPath, "utf8");
  const lines = content.split(/\r?\n/);
  let blocked = 0;

  for (let i = 0; i < lines.length; i++) {
    // Find depends_on lines that reference the blocked track
    if (lines[i].includes("**depends_on**") && lines[i].includes(blockedTrack)) {
      // Find the status line above (within 3 lines)
      for (let j = Math.max(0, i - 3); j < i; j++) {
        if (lines[j].includes("**status**") && !lines[j].includes("done")) {
          lines[j] = lines[j].replace(
            /\*\*status\*\*:\s*\S+/,
            `**status**: blocked (${reason})`
          );
          blocked++;
          break;
        }
      }
    }
  }

  if (blocked > 0) {
    writeFileSync(handoffPath, lines.join("\n"), "utf8");
  }
  return blocked;
}

// ═══ Helper: parse Residual Risk from evidence ══════════════════════════

function parseResidualRisk(evidenceContent) {
  const lines = evidenceContent.split(/\r?\n/);
  let inRisk = false;
  const risks = [];

  for (const line of lines) {
    if (/^###\s+Residual Risk/i.test(line.trim())) {
      inRisk = true;
      continue;
    }
    if (inRisk && /^###?\s+/.test(line.trim())) break; // next section
    if (inRisk && line.trim().startsWith("- ")) {
      const text = line.trim().replace(/^- /, "").trim();
      if (text && !/^none$/i.test(text) && !/^없음$/i.test(text)) {
        risks.push(text);
      }
    }
  }
  return risks;
}

// ═══ Helper: append tech debt to work-catalog ═══════════════════════════

function appendTechDebt(catalogPath, debts, track) {
  let content = existsSync(catalogPath) ? readFileSync(catalogPath, "utf8") : "";
  let appended = 0;

  for (const debt of debts) {
    // Skip if already exists
    if (content.includes(debt)) continue;
    const entry = `| TD-auto | ${debt} | tech-debt | — | low | ${track} |`;
    content = content.trimEnd() + "\n" + entry + "\n";
    appended++;
  }

  if (appended > 0) {
    writeFileSync(catalogPath, content, "utf8");
  }
  return appended;
}

// ═══ Helper: check rejection false positive rate ════════════════════════

function checkFalsePositiveRate(historyPath, track, minRounds = 5) {
  if (!existsSync(historyPath)) return { needsReview: false, codes: [] };
  const lines = readFileSync(historyPath, "utf8").split(/\r?\n/).filter(l => l.trim());

  const entries = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.track === track) entries.push(entry);
    } catch { /* skip */ }
  }

  if (entries.length < minRounds) return { needsReview: false, codes: [] };

  // Count rejection codes and their false_positive flags
  const codeStats = {};
  for (const entry of entries) {
    for (const rc of (entry.rejection_codes || [])) {
      const code = typeof rc === "string" ? rc : rc.code;
      const fp = typeof rc === "object" && rc.false_positive === true;
      if (!codeStats[code]) codeStats[code] = { total: 0, fp: 0 };
      codeStats[code].total++;
      if (fp) codeStats[code].fp++;
    }
  }

  const flagged = [];
  for (const [code, stats] of Object.entries(codeStats)) {
    if (stats.total >= 3 && (stats.fp / stats.total) > 0.3) {
      flagged.push(code);
    }
  }

  return { needsReview: flagged.length > 0, codes: flagged };
}

// ═══ 1. Upstream Delay Notification ═════════════════════════════════════

describe("upstream delay notification", () => {
  it("counts pending verdicts per track", () => {
    const historyFile = join(tmpDir, "history1.jsonl");
    writeFileSync(historyFile, [
      JSON.stringify({ track: "PA", verdict: "pending", rejection_codes: [{ code: "test-gap" }] }),
      JSON.stringify({ track: "PA", verdict: "pending", rejection_codes: [{ code: "test-gap" }] }),
      JSON.stringify({ track: "PA", verdict: "pending", rejection_codes: [{ code: "lint-gap" }] }),
      JSON.stringify({ track: "GW", verdict: "pending", rejection_codes: [{ code: "test-gap" }] }),
      JSON.stringify({ track: "PA", verdict: "agree", rejection_codes: [] }),
    ].join("\n") + "\n");

    assert.equal(countTrackPendings(historyFile, "PA"), 3);
    assert.equal(countTrackPendings(historyFile, "GW"), 1);
  });

  it("blocks downstream tasks when upstream has 3+ pendings", () => {
    const handoff = join(tmpDir, "handoff1.md");
    writeFileSync(handoff, `## Next Tasks

### [GW-1] Gateway implementation
- **status**: not-started
- **depends_on**: PA
- **blocks**: —

### [RP-1] Role protocol
- **status**: in-progress
- **depends_on**: PA
- **blocks**: —

### [EV-1] Eval pipeline
- **status**: not-started
- **depends_on**: —
- **blocks**: —
`);

    const blocked = blockDownstreamTasks(handoff, "PA", "upstream PA rejected 3x");
    assert.equal(blocked, 2); // GW-1 and RP-1 depend on PA

    const content = readFileSync(handoff, "utf8");
    assert.ok(content.includes("blocked (upstream PA rejected 3x)"));
    // EV-1 should be unchanged (no PA dependency)
    assert.ok(content.includes("[EV-1]"));
  });

  it("does not block tasks without dependency on blocked track", () => {
    const handoff = join(tmpDir, "handoff2.md");
    writeFileSync(handoff, `### [EV-1] Eval
- **status**: not-started
- **depends_on**: OB
- **blocks**: —
`);

    const blocked = blockDownstreamTasks(handoff, "PA", "upstream PA rejected 3x");
    assert.equal(blocked, 0);
  });

  it("returns 0 for missing handoff", () => {
    assert.equal(blockDownstreamTasks(join(tmpDir, "missing.md"), "PA", "test"), 0);
  });

  it("returns 0 for missing history", () => {
    assert.equal(countTrackPendings(join(tmpDir, "missing.jsonl"), "PA"), 0);
  });
});

// ═══ 2. Rejection Code Improvement ══════════════════════════════════════

describe("rejection code improvement", () => {
  it("detects high false positive rate", () => {
    const historyFile = join(tmpDir, "history2.jsonl");
    const entries = [];
    // 5 rounds with test-gap, 2 are false positives
    for (let i = 0; i < 5; i++) {
      entries.push(JSON.stringify({
        track: "SH",
        verdict: "pending",
        rejection_codes: [{ code: "test-gap", severity: "major", false_positive: i < 2 }],
      }));
    }
    writeFileSync(historyFile, entries.join("\n") + "\n");

    const result = checkFalsePositiveRate(historyFile, "SH", 5);
    assert.ok(result.needsReview);
    assert.ok(result.codes.includes("test-gap"));
  });

  it("does not flag when below threshold", () => {
    const historyFile = join(tmpDir, "history3.jsonl");
    const entries = [];
    // 10 rounds, only 1 false positive (10%)
    for (let i = 0; i < 10; i++) {
      entries.push(JSON.stringify({
        track: "TN",
        verdict: "pending",
        rejection_codes: [{ code: "lint-gap", severity: "major", false_positive: i === 0 }],
      }));
    }
    writeFileSync(historyFile, entries.join("\n") + "\n");

    const result = checkFalsePositiveRate(historyFile, "TN", 5);
    assert.ok(!result.needsReview);
  });

  it("skips when insufficient rounds", () => {
    const historyFile = join(tmpDir, "history4.jsonl");
    writeFileSync(historyFile, JSON.stringify({
      track: "OB", verdict: "pending",
      rejection_codes: [{ code: "test-gap", false_positive: true }],
    }) + "\n");

    const result = checkFalsePositiveRate(historyFile, "OB", 5);
    assert.ok(!result.needsReview); // only 1 round, needs 5
  });

  it("handles missing history", () => {
    const result = checkFalsePositiveRate(join(tmpDir, "missing.jsonl"), "X", 5);
    assert.ok(!result.needsReview);
  });
});

// ═══ 3. Technical Debt Tracking ═════════════════════════════════════════

describe("technical debt tracking", () => {
  it("parses Residual Risk items from evidence", () => {
    const evidence = `## [REVIEW_NEEDED] Track-1

### Claim
Did something.

### Changed Files
- src/a.ts

### Test Command
npx vitest run tests/a.test.ts

### Test Result
1 pass

### Residual Risk
- K1 run-task-loop branch coverage 73.4% < 75% — pre-existing gap
- has_role=false default may cause contract generation skip in edge cases
`;

    const risks = parseResidualRisk(evidence);
    assert.equal(risks.length, 2);
    assert.ok(risks[0].includes("branch coverage"));
    assert.ok(risks[1].includes("has_role"));
  });

  it("returns empty for 'None' residual risk", () => {
    const evidence = `### Residual Risk
- None
`;
    assert.deepEqual(parseResidualRisk(evidence), []);
  });

  it("returns empty for Korean 없음", () => {
    const evidence = `### Residual Risk
- 없음
`;
    assert.deepEqual(parseResidualRisk(evidence), []);
  });

  it("appends tech debt to work-catalog", () => {
    const catalog = join(tmpDir, "work-catalog.md");
    writeFileSync(catalog, `# Work Catalog

| ID | Task | Type | Model | Risk | Track |
|----|------|------|-------|------|-------|
| WB-1 | Implement X | feature | Sonnet | low | PA |
`);

    const debts = ["branch coverage 73.4% gap in run-task-loop", "has_role default issue"];
    const appended = appendTechDebt(catalog, debts, "K1");
    assert.equal(appended, 2);

    const content = readFileSync(catalog, "utf8");
    assert.ok(content.includes("TD-auto"));
    assert.ok(content.includes("branch coverage"));
    assert.ok(content.includes("has_role"));
    assert.ok(content.includes("tech-debt"));
    assert.ok(content.includes("K1"));
  });

  it("does not duplicate existing debt", () => {
    const catalog = join(tmpDir, "work-catalog2.md");
    writeFileSync(catalog, `| TD-auto | branch coverage gap | tech-debt | — | low | K1 |\n`);

    const debts = ["branch coverage gap", "new issue"];
    const appended = appendTechDebt(catalog, debts, "K1");
    assert.equal(appended, 1); // only "new issue" added

    const content = readFileSync(catalog, "utf8");
    const matches = content.match(/branch coverage gap/g);
    assert.equal(matches.length, 1); // not duplicated
  });

  it("creates catalog if missing", () => {
    const catalog = join(tmpDir, "new-catalog.md");
    const appended = appendTechDebt(catalog, ["first debt"], "PA");
    assert.equal(appended, 1);
    assert.ok(existsSync(catalog));
    assert.ok(readFileSync(catalog, "utf8").includes("first debt"));
  });
});
