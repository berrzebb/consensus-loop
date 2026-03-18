# consensus-loop

Claude Code hook plugin — tag-based consensus protocol with GPT/Codex audit. Every code edit triggers automatic audit → consensus → retrospective → commit cycle.

## Quick Commands

```bash
# Run tests
node --test tests/              # all tests
node --test tests/cl1-verify.test.mjs  # single file

# Dry run (verify hook logic without running audit)
FEEDBACK_HOOK_DRY_RUN=1 node index.mjs

# Clear plugin cache (after modifying source files)
rm -rf ~/.claude/plugins/cache/consensus-loop
```

## Core Module Map

```
index.mjs          ← PostToolUse entry: watch_file detection → audit trigger
  ├→ context.mjs   ← Shared context: config, paths, parsers, i18n (single source)
  ├→ audit.mjs     ← Background audit execution (Codex/GPT invocation, detached spawn)
  ├→ respond.mjs   ← gpt.md ↔ claude.md tag sync (promote/demote)
  └→ retrospective.mjs ← Post-consensus retro marker setup

session-gate.mjs   ← PreToolUse: blocks Bash/Agent until retrospective completes
session-start.mjs  ← SessionStart: handoff sync + context injection
session-stop.mjs   ← Stop: handoff sync + auto-commit
subagent-stop.mjs  ← SubagentStop: worker completion detection + deferred retro

cli-runner.mjs     ← Cross-platform binary resolver (codex/claude)
handoff-writer.mjs ← Bidirectional repo ↔ Claude memory handoff sync
i18n.mjs           ← Standalone locale helper (for non-context.mjs imports)
```

## config.json

Location: `consensus-loop/config.json` (gitignored, project-specific)

Key fields:
- `plugin.locale` — `"ko"` or `"en"` (invalid values fall back to `"en"`)
- `consensus.watch_file` — evidence file path (relative to repo root, e.g., `docs/feedback/claude.md`)
- `consensus.trigger_tag` / `agree_tag` / `pending_tag` — state transition tags
- `quality_rules[]` — auto-run quality checks on file edit (ESLint, tsc, etc.)

Example: `examples/config.example.json`

### Hook Toggles

Disable individual hooks via `plugin.hooks_enabled` (all default to `true`):

```json
{
  "plugin": {
    "hooks_enabled": {
      "audit": true,          // Audit trigger (PostToolUse)
      "session_gate": true,   // Retro enforcement gate (PreToolUse)
      "quality_rules": true,  // Per-file quality checks (PostToolUse)
      "pre_compact": true     // State snapshot before compaction (PreCompact)
    }
  }
}
```

## Gotcha

- **audit.lock** — PID + TTL at `REPO_ROOT/.claude/audit.lock` prevents concurrent audits. Auto-released on TTL expiry or PID death. Check `audit-bg.log` before manual deletion.
- **Reentrance guard** — `FEEDBACK_LOOP_ACTIVE=1` env var prevents child process re-entry. Blocks infinite loops where hook → audit script → file edit → hook re-triggers.
- **Debounce** — Consecutive edits debounced for 10 seconds. Managed via `REPO_ROOT/.claude/audit-debounce.ts` timestamp. Only the last edit triggers audit.
- **Worktree awareness** — `context.mjs` `resolveRepoRoot()` uses cwd-based `git rev-parse` first. Sub-agents in worktrees use the worktree root, not the main repo.
- **Fail-open** — session-gate errors pass through (prevents system lockout). Audit failures likewise.
- **PreCompact snapshot** — Before `/compact`, saves audit state (retro-marker, audit.lock, last item) to `REPO_ROOT/.claude/compaction-snapshot.json`. Auto-restored on SessionStart.
- **Context Reinforcement** — SessionStart re-injects AI-GUIDE.md "Absolute Rules" section via `<CONTEXT-REINFORCEMENT>` tag. Ensures core protocol rules survive context compression.

## Code Patterns

- **Facade prompts**: `templates/*.md` are ~30-line facades → reference `templates/references/{locale}/` policy files. `{{REFERENCES_DIR}}` resolved at runtime.
- **i18n**: `locales/{ko,en}.json` + `context.mjs` `t()` function. Uses `plugin.locale` config value.
- **context.mjs single source**: All scripts import config, paths, tag constants from `context.mjs`. No duplicate parsing.
- **Policy as Data**: Audit criteria changes require no code changes → edit `references/{locale}/*.md` only.

## Resume (auto-recovery)

When a session restarts after interruption, `session-start.mjs` auto-detects the following states and provides specific resume instructions:

| Detection Condition | Resume Instruction |
|--------------------|--------------------|
| audit.lock exists + PID dead | Auto-clean lock → re-submit evidence |
| gpt.md contains `[pending_tag]` | Extract rejection codes → correct + resubmit |
| watch_file has `[trigger_tag]` + no audit result | Audit not run/failed → resubmit |
| retro-marker `retro_pending` | Retrospective incomplete → protocol instructions |
| retro-marker `deferred_to_orchestrator` | Sub-agent retro delegation → orchestrator retro |
| handoff has `in-progress` tasks | Incomplete tracks → orchestrator resume |
| compaction-snapshot exists | Restore pre-compaction state |

## Tests

- Location: `tests/` (Node.js built-in test runner)
- Helpers: `tests/_helpers.mjs` — common mocking/utilities
- Environment: `FEEDBACK_HOOK_DRY_RUN=1` for dependency-free logic verification
