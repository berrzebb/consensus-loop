# consensus-loop (v2.5.1)

Claude Code hook plugin — cross-model audit gate with structural enforcement. edit → audit → agree → retro → commit.

## Quick Commands

```bash
node --test tests/              # all tests
node --test tests/cl1-verify.test.mjs  # single file
FEEDBACK_HOOK_DRY_RUN=1 node index.mjs # dry run
rm -rf ~/.claude/plugins/cache/berrzebb-plugins  # clear cache
```

## Module Map

```
index.mjs          ← PostToolUse: watch_file → audit trigger
  ├→ context.mjs   ← Config, paths, parsers, i18n (single source)
  ├→ audit.mjs     ← Background audit (Codex/GPT, pre-verification)
  ├→ respond.mjs   ← Tag sync (promote/demote)
  └→ retrospective.mjs ← Retro marker setup

session-gate.mjs    ← PreToolUse: blocks Bash/Agent until retro completes
session-start.mjs   ← SessionStart: handoff sync + resume detection
session-stop.mjs    ← Stop: handoff sync + auto-commit
subagent-start.mjs  ← SubagentStart: inject audit state into agents
subagent-stop.mjs   ← SubagentStop: worker completion + deferred retro
pre-compact.mjs     ← PreCompact: save audit state
post-compact.mjs    ← PostCompact: restore audit state
worktree-create.mjs ← WorktreeCreate: auto-configure + merge permissions
worktree-remove.mjs ← WorktreeRemove: preserve evidence + cleanup
teammate-idle.mjs   ← TeammateIdle: CQ gate (agent teams)
task-completed.mjs  ← TaskCompleted: done-criteria gate (agent teams)
```

## Skills (9) + Agents (3)

| Skill | Shortcut | Purpose |
|-------|----------|---------|
| `consensus-loop:orchestrator` | `/cl-orch` | Distribute, track, correct, merge |
| `consensus-loop:planner` | `/cl-plan` | PRD + 10 design doc types |
| `consensus-loop:verify` | `/cl-verify` | 8 done-criteria checks |
| `consensus-loop:merge` | `/cl-merge` | Squash-merge + emergency rollback |
| `consensus-loop:retrospect` | `/cl-retro` | Memory extraction (Quick/Full) |
| `consensus-loop:audit` | `/cl-audit` | Manual audit trigger |
| `consensus-loop:status` | `/cl-status` | Current state check |
| `consensus-loop:guide` | `/cl-guide` | Evidence writing guide |
| `consensus-loop:tools` | `/cl-tools` | CLI for 9 MCP tools |

| Agent | Model | Role |
|-------|-------|------|
| implementer | Sonnet | Headless worker (worktree, completion gate) |
| scout | Opus | Read-only RTM generator (3-way) |
| ui-reviewer | Sonnet | Browser-based UI verification |

All skills support **headless mode** — no interactive prompts in subagent context.

## MCP Tools (9)

All available via CLI: `node scripts/tool-runner.mjs <tool> --param value`

`code_map` · `dependency_graph` · `audit_scan` · `coverage_map` · `rtm_parse` · `rtm_merge` · `audit_history` · `fvm_generate` · `fvm_validate`

## Config

`config.json` — tags, paths, quality rules, hook toggles. See `examples/config.example.json`.

Key: `plugin.locale`, `consensus.watch_file`, `consensus.trigger_tag`/`agree_tag`/`pending_tag`, `quality_rules[]`

## Key Patterns

- **Facade prompts**: templates/*.md → references/{locale}/ policy files
- **Pre-verification**: audit.mjs runs CQ/T/CC locally, injects `{{PRE_VERIFIED}}` into auditor prompt
- **Worktree chain**: `--watch-file` propagates through index → audit → respond
- **Tier routing**: T1 (micro, no worktree) → T2 (standard, worktree+audit) → T3 (complex, scout+full audit)
- **Policy as Data**: edit references/*.md to change audit criteria, no code changes
- **Fail-open**: all hooks pass through on error (no system lockout)

## Resume (auto-recovery)

`session-start.mjs` auto-detects: stale audit.lock, pending verdicts, incomplete retro, active agents, compaction snapshot.

## Tests

```bash
node --test tests/                          # all (context, hooks, MCP, FVM, enforcement)
node --test tests/hooks-lifecycle.test.mjs  # 17 hook tests
node --test tests/fvm-integration.test.mjs  # full FVM pipeline (5 roles)
```
