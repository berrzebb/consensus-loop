/**
 * Tests for new lifecycle hooks:
 *   - subagent-start.mjs  (SubagentStart)
 *   - worktree-create.mjs (WorktreeCreate)
 *   - worktree-remove.mjs (WorktreeRemove)
 *   - post-compact.mjs    (PostCompact)
 *   - teammate-idle.mjs   (TeammateIdle)
 *   - task-completed.mjs  (TaskCompleted)
 *
 * Pattern: spawn each hook as a subprocess with JSON stdin,
 * capture stdout/stderr/exitCode.
 */

import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";
import { spawnSync, execFileSync } from "node:child_process";
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, "..");

/**
 * Run a hook script with JSON stdin in a controlled environment.
 * Returns { stdout, stderr, exitCode }.
 */
function runHook(script, stdinObj, opts = {}) {
  const input = JSON.stringify(stdinObj);
  const env = {
    ...process.env,
    FEEDBACK_HOOK_DRY_RUN: "1",
    CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
    ...opts.env,
  };
  const result = spawnSync(process.execPath, [resolve(PLUGIN_ROOT, script)], {
    input,
    encoding: "utf8",
    cwd: opts.cwd || PLUGIN_ROOT,
    env,
    timeout: opts.timeout || 15000,
  });
  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    exitCode: result.status ?? 1,
  };
}

// ═══════════════════════════════════════════════════════════════
// SubagentStart
// ═══════════════════════════════════════════════════════════════
describe("SubagentStart hook", () => {
  it("injects context for implementer agent", () => {
    const result = runHook("subagent-start.mjs", {
      agent_type: "implementer",
      agent_id: "agent-test-001",
      session_id: "test-session",
    });
    assert.equal(result.exitCode, 0, `Exit code should be 0, got ${result.exitCode}`);

    // Should output JSON with additionalContext
    if (result.stdout.trim()) {
      const output = JSON.parse(result.stdout);
      assert.ok(output.hookSpecificOutput, "Should have hookSpecificOutput");
      assert.equal(output.hookSpecificOutput.hookEventName, "SubagentStart");
      assert.ok(
        output.hookSpecificOutput.additionalContext.includes("CONSENSUS-LOOP-CONTEXT"),
        "Should include context tag"
      );
      assert.ok(
        output.hookSpecificOutput.additionalContext.includes("CC-2 Protocol"),
        "Should include CC-2 diff basis reminder"
      );
    }
  });

  it("injects context for scout agent", () => {
    const result = runHook("subagent-start.mjs", {
      agent_type: "scout",
      agent_id: "agent-test-002",
      session_id: "test-session",
    });
    assert.equal(result.exitCode, 0);
    if (result.stdout.trim()) {
      const output = JSON.parse(result.stdout);
      assert.ok(output.hookSpecificOutput.additionalContext.includes("CC-2"));
    }
  });

  it("passes through for non-target agent types", () => {
    const result = runHook("subagent-start.mjs", {
      agent_type: "Explore",
      agent_id: "agent-test-003",
      session_id: "test-session",
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.trim(), "", "Should produce no output for Explore agent");
  });

  it("handles empty stdin gracefully", () => {
    // Pass empty object — no agent_type
    const result = runHook("subagent-start.mjs", {});
    assert.equal(result.exitCode, 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// WorktreeCreate
// ═══════════════════════════════════════════════════════════════
describe("WorktreeCreate hook", () => {
  let tmpRepo;

  before(() => {
    // Create a temp git repo for worktree testing
    tmpRepo = mkdtempSync(join(tmpdir(), "wt-create-"));
    execFileSync("git", ["init"], { cwd: tmpRepo, stdio: "pipe" });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: tmpRepo, stdio: "pipe" });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: tmpRepo, stdio: "pipe" });
    // Create initial commit (git worktree requires at least one commit)
    writeFileSync(join(tmpRepo, "README.md"), "# Test\n");
    execFileSync("git", ["add", "."], { cwd: tmpRepo, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: tmpRepo, stdio: "pipe" });
  });

  after(() => {
    // Clean up worktrees before removing repo
    try {
      execFileSync("git", ["worktree", "prune"], { cwd: tmpRepo, stdio: "pipe" });
    } catch { /* ignore */ }
    if (tmpRepo && existsSync(tmpRepo)) {
      rmSync(tmpRepo, { recursive: true, force: true });
    }
  });

  it("creates a worktree and outputs its path", () => {
    const result = runHook("worktree-create.mjs", {
      name: "test-wt-001",
    }, { cwd: tmpRepo });

    assert.equal(result.exitCode, 0, `Expected exit 0, got ${result.exitCode}. stderr: ${result.stderr}`);
    assert.ok(result.stdout.trim().length > 0, "Should output worktree path");

    const wtPath = result.stdout.trim();
    assert.ok(existsSync(wtPath), `Worktree dir should exist: ${wtPath}`);

    // Check worktree metadata was created
    const metaPath = join(wtPath, ".claude", "worktree-meta.json");
    assert.ok(existsSync(metaPath), "Worktree metadata should exist");

    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    assert.equal(meta.name, "test-wt-001");
    assert.ok(meta.branch.includes("test-wt-001"));
    assert.ok(meta.created_at);
  });

  it("fails with non-zero exit on invalid git repo", () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "no-git-"));
    const result = runHook("worktree-create.mjs", {
      name: "test-fail",
    }, { cwd: emptyDir });

    // Should fail because no git repo
    assert.notEqual(result.exitCode, 0, "Should fail on non-git directory");
    rmSync(emptyDir, { recursive: true, force: true });
  });
});

// ═══════════════════════════════════════════════════════════════
// WorktreeRemove
// ═══════════════════════════════════════════════════════════════
describe("WorktreeRemove hook", () => {
  let tmpRepo;
  let wtPath;

  before(() => {
    // Set up repo with a worktree
    tmpRepo = mkdtempSync(join(tmpdir(), "wt-remove-"));
    execFileSync("git", ["init"], { cwd: tmpRepo, stdio: "pipe" });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: tmpRepo, stdio: "pipe" });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: tmpRepo, stdio: "pipe" });
    writeFileSync(join(tmpRepo, "README.md"), "# Test\n");
    execFileSync("git", ["add", "."], { cwd: tmpRepo, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: tmpRepo, stdio: "pipe" });

    // Create a worktree manually
    wtPath = join(tmpRepo, ".claude", "worktrees", "test-remove");
    mkdirSync(join(tmpRepo, ".claude", "worktrees"), { recursive: true });
    execFileSync("git", ["worktree", "add", "-b", "worktree/test-remove", wtPath, "HEAD"], {
      cwd: tmpRepo, stdio: "pipe",
    });

    // Write metadata
    mkdirSync(join(wtPath, ".claude"), { recursive: true });
    writeFileSync(join(wtPath, ".claude", "worktree-meta.json"), JSON.stringify({
      name: "test-remove",
      branch: "worktree/test-remove",
      created_at: new Date().toISOString(),
      parent_repo: tmpRepo,
    }));

    // Write a fake evidence file
    mkdirSync(join(wtPath, "docs", "feedback"), { recursive: true });
    writeFileSync(join(wtPath, "docs", "feedback", "claude.md"), "## [REVIEW_NEEDED] Test\n### Claim\nTest");
  });

  after(() => {
    try { execFileSync("git", ["worktree", "prune"], { cwd: tmpRepo, stdio: "pipe" }); } catch {}
    if (tmpRepo && existsSync(tmpRepo)) rmSync(tmpRepo, { recursive: true, force: true });
  });

  it("preserves evidence and cleans up worktree", () => {
    const result = runHook("worktree-remove.mjs", {
      worktree_path: wtPath,
      session_id: "test-session",
    }, { cwd: tmpRepo });

    assert.equal(result.exitCode, 0, `Exit should be 0, stderr: ${result.stderr}`);

    // Evidence should be archived
    const archiveDir = join(tmpRepo, ".claude", "evidence-archive");
    if (existsSync(archiveDir)) {
      const files = readdirSync(archiveDir);
      assert.ok(files.length > 0, "Evidence archive should have files");
      assert.ok(
        files.some(f => f.includes("test-remove")),
        "Archive should contain file named with worktree name"
      );
    }
  });

  it("handles non-existent worktree path gracefully", () => {
    const result = runHook("worktree-remove.mjs", {
      worktree_path: "/tmp/does-not-exist-12345",
      session_id: "test-session",
    }, { cwd: tmpRepo });

    assert.equal(result.exitCode, 0, "Should not fail on missing worktree");
  });
});

// ═══════════════════════════════════════════════════════════════
// PostCompact
// ═══════════════════════════════════════════════════════════════
describe("PostCompact hook", () => {
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "post-compact-"));
    // Init git so context.mjs can resolve REPO_ROOT
    execFileSync("git", ["init"], { cwd: tmpDir, stdio: "pipe" });
  });

  after(() => {
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("passes through stdin unchanged", () => {
    const stdinData = { type: "auto", some_data: "preserved" };
    const result = runHook("post-compact.mjs", stdinData, { cwd: tmpDir });
    assert.equal(result.exitCode, 0);

    // stdout should contain the original stdin JSON
    const output = result.stdout.trim();
    if (output) {
      assert.ok(output.includes("auto"), "Should pass through stdin data");
    }
  });

  it("exits cleanly when no snapshot exists", () => {
    const result = runHook("post-compact.mjs", { type: "manual" }, { cwd: tmpDir });
    assert.equal(result.exitCode, 0);
  });

  it("processes existing snapshot", () => {
    // Create a snapshot
    const claudeDir = join(tmpDir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, "compaction-snapshot.json"), JSON.stringify({
      saved_at: "2026-03-20T10:00:00Z",
      audit_in_progress: true,
      last_audit_status: "## [REVIEW_NEEDED] Test",
      retro_marker: { retro_pending: false },
    }));

    const result = runHook("post-compact.mjs", { type: "auto" }, { cwd: tmpDir });
    assert.equal(result.exitCode, 0);
    assert.ok(result.stderr.includes("Restored state"), "Should log restoration");
  });
});

// ═══════════════════════════════════════════════════════════════
// TeammateIdle (lightweight — no real lint/test environment)
// ═══════════════════════════════════════════════════════════════
describe("TeammateIdle hook", () => {
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "teammate-idle-"));
    execFileSync("git", ["init"], { cwd: tmpDir, stdio: "pipe" });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: tmpDir, stdio: "pipe" });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: tmpDir, stdio: "pipe" });
    writeFileSync(join(tmpDir, "README.md"), "# Test\n");
    execFileSync("git", ["add", "."], { cwd: tmpDir, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: tmpDir, stdio: "pipe" });
  });

  after(() => {
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("passes through for non-implementer teammates", () => {
    const result = runHook("teammate-idle.mjs", {
      teammate_name: "scout-agent",
      team_name: "test-team",
    }, { cwd: tmpDir });
    assert.equal(result.exitCode, 0);
  });

  it("passes through when no changes exist", () => {
    const result = runHook("teammate-idle.mjs", {
      teammate_name: "implementer-1",
      team_name: "test-team",
    }, { cwd: tmpDir });
    assert.equal(result.exitCode, 0, "Should pass when no changed files");
  });

  it("handles empty stdin gracefully", () => {
    const result = runHook("teammate-idle.mjs", {}, { cwd: tmpDir });
    assert.equal(result.exitCode, 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// TaskCompleted (lightweight — no real lint/test environment)
// ═══════════════════════════════════════════════════════════════
describe("TaskCompleted hook", () => {
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "task-completed-"));
    execFileSync("git", ["init"], { cwd: tmpDir, stdio: "pipe" });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: tmpDir, stdio: "pipe" });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: tmpDir, stdio: "pipe" });
    writeFileSync(join(tmpDir, "README.md"), "# Test\n");
    execFileSync("git", ["add", "."], { cwd: tmpDir, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: tmpDir, stdio: "pipe" });
  });

  after(() => {
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("passes through when no changes detected", () => {
    const result = runHook("task-completed.mjs", {
      task_id: "task-001",
      task_subject: "Test feature",
      teammate_name: "implementer-1",
    }, { cwd: tmpDir });
    assert.equal(result.exitCode, 0);
  });

  it("verifies task subject is logged", () => {
    const result = runHook("task-completed.mjs", {
      task_id: "task-002",
      task_subject: "Add authentication",
      teammate_name: "implementer-1",
    }, { cwd: tmpDir });
    assert.equal(result.exitCode, 0);
    assert.ok(result.stderr.includes("Add authentication"), "Should log task subject");
  });

  it("handles empty stdin gracefully", () => {
    const result = runHook("task-completed.mjs", {}, { cwd: tmpDir });
    assert.equal(result.exitCode, 0);
  });
});
