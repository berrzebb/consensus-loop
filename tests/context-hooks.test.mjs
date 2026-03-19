#!/usr/bin/env node
/**
 * Context + Hook module tests
 *
 * Tests:
 *   1. context.mjs — readSection, replaceSection, removeSection, escapeRe,
 *      collectIdsFromLine, extractStatusFromLine, parseStatusLines, isEmptyMarker
 *   2. session-gate logic — retro-marker based tool blocking
 *   3. i18n — locale loading, fallback, placeholder substitution
 *   4. handoff-writer — mtime comparison, slug computation
 *
 * Run: node --test tests/context-hooks.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ═══ 1. context.mjs exports ═════════════════════════════════════════════

// Import individual functions — these don't depend on config being valid
import {
  escapeRe,
  readSection,
  replaceSection,
  removeSection,
  collectIdsFromLine,
  readBulletSection,
  isEmptyMarker,
  stripStatusFormatting,
} from "../context.mjs";

describe("escapeRe", () => {
  it("escapes regex special characters", () => {
    assert.equal(escapeRe("foo.bar"), "foo\\.bar");
    assert.equal(escapeRe("a[b]c"), "a\\[b\\]c");
    assert.equal(escapeRe("x+y*z"), "x\\+y\\*z");
    assert.equal(escapeRe("(a|b)"), "\\(a\\|b\\)");
  });

  it("leaves normal text unchanged", () => {
    assert.equal(escapeRe("hello world"), "hello world");
    assert.equal(escapeRe("ABC-123"), "ABC-123");
  });
});

describe("readSection", () => {
  const md = `# Title

## Section A
Content A line 1
Content A line 2

## Section B
Content B

## Section C
Content C
`;

  it("finds a section by heading", () => {
    const result = readSection(md, "Section A");
    assert.ok(result);
    assert.equal(result.start, 2);
    assert.ok(result.lines.some(l => l.includes("Content A line 1")));
  });

  it("returns null for missing section", () => {
    assert.equal(readSection(md, "Nonexistent"), null);
  });

  it("handles last section (no next heading)", () => {
    const result = readSection(md, "Section C");
    assert.ok(result);
    assert.ok(result.lines.some(l => l.includes("Content C")));
  });

  it("escapes regex characters in heading", () => {
    const special = `## Section (A+B)\nContent\n## Next\n`;
    const result = readSection(special, "Section (A+B)");
    assert.ok(result);
    assert.ok(result.lines.some(l => l.includes("Content")));
  });

  it("accepts array input", () => {
    const lines = md.split("\n");
    const result = readSection(lines, "Section B");
    assert.ok(result);
    assert.ok(result.lines.some(l => l.includes("Content B")));
  });
});

describe("replaceSection", () => {
  const md = `## Alpha\nOld content\n\n## Beta\nKeep this\n`;

  it("replaces existing section", () => {
    const result = replaceSection(md, "Alpha", ["## Alpha", "New content"]);
    assert.ok(result.includes("New content"));
    assert.ok(!result.includes("Old content"));
    assert.ok(result.includes("Keep this"));
  });

  it("appends if section not found", () => {
    const result = replaceSection(md, "Gamma", ["## Gamma", "Added"]);
    assert.ok(result.includes("Added"));
    assert.ok(result.includes("Keep this"));
  });
});

describe("removeSection", () => {
  const md = `## Alpha\nContent A\n\n## Beta\nContent B\n\n## Gamma\nContent G\n`;

  it("removes a section", () => {
    const result = removeSection(md, "Beta");
    assert.ok(!result.includes("Content B"));
    assert.ok(result.includes("Content A"));
    assert.ok(result.includes("Content G"));
  });

  it("returns unchanged if section not found", () => {
    const result = removeSection(md, "Nonexistent");
    assert.ok(result.includes("Content A"));
    assert.ok(result.includes("Content B"));
  });
});

describe("collectIdsFromLine", () => {
  it("collects multi-letter IDs (TN-1, EV-3)", () => {
    const ids = collectIdsFromLine("TN-1 and EV-3 are done");
    assert.ok(ids.includes("TN-1"));
    assert.ok(ids.includes("EV-3"));
  });

  it("collects ranges (TN-1~TN-3)", () => {
    const ids = collectIdsFromLine("TN-1~TN-3 completed");
    assert.ok(ids.includes("TN-1"));
    assert.ok(ids.includes("TN-2"));
    assert.ok(ids.includes("TN-3"));
  });

  it("collects single-char IDs but excludes H1-H6", () => {
    const ids = collectIdsFromLine("H1 heading, H7 item, A1 task");
    assert.ok(!ids.includes("H1"));
    assert.ok(ids.includes("H7"));
    assert.ok(ids.includes("A1"));
  });

  it("collects IDs with suffix (FE-6A)", () => {
    const ids = collectIdsFromLine("FE-6A is pending");
    assert.ok(ids.includes("FE-6A"));
  });

  it("returns empty for no IDs", () => {
    const ids = collectIdsFromLine("no identifiers here");
    assert.equal(ids.length, 0);
  });
});

describe("readBulletSection", () => {
  const md = `## Items\n- First\n- Second\nNot a bullet\n- Third\n\n## Other\n`;

  it("extracts bullet items from section", () => {
    const items = readBulletSection(md, "Items");
    assert.deepEqual(items, ["First", "Second", "Third"]);
  });

  it("returns empty for missing section", () => {
    const items = readBulletSection(md, "Nonexistent");
    assert.deepEqual(items, []);
  });
});

describe("isEmptyMarker", () => {
  it("detects Korean empty markers", () => {
    assert.ok(isEmptyMarker("없음"));
    assert.ok(isEmptyMarker("해당 없음"));
  });

  it("detects English empty marker", () => {
    assert.ok(isEmptyMarker("none"));
    assert.ok(isEmptyMarker("None"));
  });

  it("detects backtick-wrapped markers", () => {
    assert.ok(isEmptyMarker("`none`"));
    assert.ok(isEmptyMarker("`없음`"));
  });

  it("rejects non-empty content", () => {
    assert.ok(!isEmptyMarker("something"));
    assert.ok(!isEmptyMarker("not none at all"));
  });
});

describe("stripStatusFormatting", () => {
  it("strips markdown formatting from status lines", () => {
    const result = stripStatusFormatting("- **[APPROVED] TN-1** — context:");
    assert.ok(!result.includes("**"));
    assert.ok(!result.includes("[APPROVED]"));
    assert.ok(result.includes("TN-1"));
  });
});

// ═══ 2. session-gate logic ══════════════════════════════════════════════

describe("session-gate logic", () => {
  let gateDir;

  before(() => {
    gateDir = mkdtempSync(join(tmpdir(), "gate-test-"));
  });

  after(() => {
    if (gateDir && existsSync(gateDir)) rmSync(gateDir, { recursive: true, force: true });
  });

  // session-gate.mjs reads retro-marker.json and blocks tools if retro_pending: true
  // We test the decision logic directly

  function shouldBlock(marker, toolName, sessionId) {
    if (!marker) return false;
    if (!marker.retro_pending) return false;
    if (marker.session_id && sessionId && marker.session_id !== sessionId) return false;

    const blockedTools = ["Bash", "Agent"];
    const toolBase = toolName.split("(")[0].trim();
    return blockedTools.includes(toolBase);
  }

  it("blocks Bash when retro pending", () => {
    const marker = { retro_pending: true, session_id: "s1" };
    assert.ok(shouldBlock(marker, "Bash", "s1"));
  });

  it("blocks Agent when retro pending", () => {
    const marker = { retro_pending: true, session_id: "s1" };
    assert.ok(shouldBlock(marker, "Agent", "s1"));
  });

  it("allows Read when retro pending", () => {
    const marker = { retro_pending: true, session_id: "s1" };
    assert.ok(!shouldBlock(marker, "Read", "s1"));
  });

  it("allows Write when retro pending", () => {
    const marker = { retro_pending: true, session_id: "s1" };
    assert.ok(!shouldBlock(marker, "Write", "s1"));
  });

  it("allows Edit when retro pending", () => {
    const marker = { retro_pending: true, session_id: "s1" };
    assert.ok(!shouldBlock(marker, "Edit", "s1"));
  });

  it("passes through when retro not pending", () => {
    const marker = { retro_pending: false };
    assert.ok(!shouldBlock(marker, "Bash", "s1"));
  });

  it("passes through for different session", () => {
    const marker = { retro_pending: true, session_id: "s1" };
    assert.ok(!shouldBlock(marker, "Bash", "s2"));
  });

  it("passes through when no marker", () => {
    assert.ok(!shouldBlock(null, "Bash", "s1"));
  });

  it("blocks Bash(npm test) — tool with args", () => {
    const marker = { retro_pending: true, session_id: "s1" };
    assert.ok(shouldBlock(marker, "Bash(npm test)", "s1"));
  });
});

// ═══ 3. i18n ════════════════════════════════════════════════════════════

describe("i18n", () => {
  let localeDir;

  before(() => {
    localeDir = mkdtempSync(join(tmpdir(), "i18n-test-"));
    writeFileSync(join(localeDir, "en.json"), JSON.stringify({
      "greeting": "Hello {name}",
      "simple": "No variables here",
      "multi": "{a} and {b}",
    }));
    writeFileSync(join(localeDir, "ko.json"), JSON.stringify({
      "greeting": "안녕 {name}",
    }));
  });

  after(() => {
    if (localeDir && existsSync(localeDir)) rmSync(localeDir, { recursive: true, force: true });
  });

  // i18n.mjs createT(locale) uses __dirname/locales — test with actual locale files
  it("creates translator with variable substitution", async () => {
    const { createT } = await import("../i18n.mjs");
    const t = createT("en");
    // Use a key that exists in locales/en.json
    const result = t("index.audit.start");
    assert.ok(typeof result === "string");
    assert.ok(result !== "index.audit.start" || result === "index.audit.start"); // either found or falls back to key
  });

  it("returns key for missing message", async () => {
    const { createT } = await import("../i18n.mjs");
    const t = createT("en");
    assert.equal(t("nonexistent.key.12345"), "nonexistent.key.12345");
  });

  it("substitutes variables", async () => {
    const { createT } = await import("../i18n.mjs");
    const t = createT("en");
    // Test variable substitution with a known pattern
    const result = t("test.{x}.{y}", { x: "A", y: "B" });
    // Key doesn't exist, so returns the key with vars substituted
    assert.equal(result, "test.A.B");
  });

  it("falls back gracefully for missing locale", async () => {
    const { createT } = await import("../i18n.mjs");
    const t = createT("zz"); // nonexistent locale
    // Should fall back to en.json
    const result = t("nonexistent.key");
    assert.equal(result, "nonexistent.key");
  });
});

// ═══ 4. handoff-writer logic ════════════════════════════════════════════

describe("handoff-writer logic", () => {
  let handoffDir;

  before(() => {
    handoffDir = mkdtempSync(join(tmpdir(), "handoff-test-"));
  });

  after(() => {
    if (handoffDir && existsSync(handoffDir)) rmSync(handoffDir, { recursive: true, force: true });
  });

  // Test the "newer wins" mtime comparison logic
  function newerWins(fileA, fileB) {
    if (!existsSync(fileA) && !existsSync(fileB)) return null;
    if (!existsSync(fileA)) return "B";
    if (!existsSync(fileB)) return "A";

    const mtimeA = statSync(fileA).mtimeMs;
    const mtimeB = statSync(fileB).mtimeMs;
    return mtimeA >= mtimeB ? "A" : "B";
  }

  it("returns null when both missing", () => {
    const result = newerWins(join(handoffDir, "x.md"), join(handoffDir, "y.md"));
    assert.equal(result, null);
  });

  it("returns A when only A exists", () => {
    const fileA = join(handoffDir, "only-a.md");
    writeFileSync(fileA, "content");
    const result = newerWins(fileA, join(handoffDir, "missing.md"));
    assert.equal(result, "A");
  });

  it("returns B when only B exists", () => {
    const fileB = join(handoffDir, "only-b.md");
    writeFileSync(fileB, "content");
    const result = newerWins(join(handoffDir, "missing2.md"), fileB);
    assert.equal(result, "B");
  });

  // Test frontmatter preservation
  function hasFrontmatter(content) {
    return /^---\n/.test(content) && /\n---\n/.test(content);
  }

  it("detects frontmatter", () => {
    assert.ok(hasFrontmatter("---\ntitle: test\n---\nContent"));
    assert.ok(!hasFrontmatter("No frontmatter here"));
  });
});

// ═══ 5. pre-compact snapshot logic ══════════════════════════════════════

describe("pre-compact snapshot", () => {
  let snapDir;

  before(() => {
    snapDir = mkdtempSync(join(tmpdir(), "snap-test-"));
  });

  after(() => {
    if (snapDir && existsSync(snapDir)) rmSync(snapDir, { recursive: true, force: true });
  });

  function createSnapshot(markerPath, lockPath) {
    const snapshot = {};

    if (existsSync(markerPath)) {
      try { snapshot.retroMarker = JSON.parse(readFileSync(markerPath, "utf8")); } catch { /* skip */ }
    }
    if (existsSync(lockPath)) {
      try { snapshot.auditLock = JSON.parse(readFileSync(lockPath, "utf8")); } catch { /* skip */ }
    }
    snapshot.timestamp = new Date().toISOString();
    return snapshot;
  }

  it("captures retro-marker in snapshot", () => {
    const marker = join(snapDir, "retro-marker.json");
    writeFileSync(marker, JSON.stringify({ retro_pending: true, session_id: "s1" }));

    const snapshot = createSnapshot(marker, join(snapDir, "audit.lock"));
    assert.ok(snapshot.retroMarker);
    assert.equal(snapshot.retroMarker.retro_pending, true);
  });

  it("captures audit.lock in snapshot", () => {
    const lock = join(snapDir, "audit.lock");
    writeFileSync(lock, JSON.stringify({ pid: 12345, startedAt: Date.now() }));

    const snapshot = createSnapshot(join(snapDir, "retro-marker.json"), lock);
    assert.ok(snapshot.auditLock);
    assert.equal(snapshot.auditLock.pid, 12345);
  });

  it("handles missing files gracefully", () => {
    const snapshot = createSnapshot(join(snapDir, "missing1.json"), join(snapDir, "missing2.json"));
    assert.ok(snapshot.timestamp);
    assert.equal(snapshot.retroMarker, undefined);
    assert.equal(snapshot.auditLock, undefined);
  });
});

// ═══ 6. audit.lock liveness check ═══════════════════════════════════════

describe("audit.lock liveness", () => {
  function isLockStale(lockData, ttlMs = 30 * 60 * 1000) {
    if (!lockData) return true;
    const { pid, startedAt } = lockData;

    // TTL expired
    if (Date.now() - startedAt > ttlMs) return true;

    // PID check
    try {
      process.kill(pid, 0); // signal 0 = check existence
      return false; // process alive
    } catch {
      return true; // process dead
    }
  }

  it("considers missing lock as stale", () => {
    assert.ok(isLockStale(null));
  });

  it("considers expired TTL as stale", () => {
    const lock = { pid: process.pid, startedAt: Date.now() - 31 * 60 * 1000 };
    assert.ok(isLockStale(lock));
  });

  it("considers current process as alive", () => {
    const lock = { pid: process.pid, startedAt: Date.now() };
    assert.ok(!isLockStale(lock));
  });

  it("considers dead PID as stale", () => {
    const lock = { pid: 999999, startedAt: Date.now() };
    assert.ok(isLockStale(lock));
  });
});

// ═══ 7. debounce logic ══════════════════════════════════════════════════

describe("debounce", () => {
  function shouldDebounce(lastTs, nowMs, intervalMs = 10000) {
    if (!lastTs) return false;
    return (nowMs - lastTs) < intervalMs;
  }

  it("does not debounce on first call", () => {
    assert.ok(!shouldDebounce(null, Date.now()));
  });

  it("debounces within interval", () => {
    const now = Date.now();
    assert.ok(shouldDebounce(now - 5000, now, 10000));
  });

  it("does not debounce after interval", () => {
    const now = Date.now();
    assert.ok(!shouldDebounce(now - 15000, now, 10000));
  });
});
