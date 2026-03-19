# Consensus Loop — Plugin Reference

> Status: `active` | Scope: `.claude/hooks/consensus-loop`

A hook plugin implementing a **tag-based two-party consensus protocol** + **HITL retrospective gate** between Claude (implementer) and an external AI auditor (GPT/Codex).

Automatically enforces an edit → audit → agree → retro → commit cycle.

---

## Why This Exists

1. **Independent critic** — The AI that writes (Claude) and the AI that reviews (GPT) are separated.
2. **No progress without consensus** — `[trigger_tag]` items remain incomplete until promoted to `[agree_tag]`.
3. **HITL retrospective** — After consensus, session-gate blocks commits until a human-in-the-loop retrospective is complete.
4. **Policy as data** — Audit criteria, rejection codes, and output formats are managed in `references/` files. No code changes needed to adjust team policy.

---

## Folder Structure

```
consensus-loop/
│
├── .claude-plugin/
│   └── plugin.json        ← Plugin metadata (name, version, author)
│
├── .mcp.json              ← MCP server declaration (auto-registered by plugin system)
│
├── hooks/
│   └── hooks.json         ← Hook event registration (auto-discovered)
│
├── skills/                ← Slash-command skills (auto-discovered, prefix: consensus-loop:)
│   ├── orchestrator/      ← consensus-loop:orchestrator — multi-track distribution + agent registry
│   ├── verify-implementation/ ← consensus-loop:verify — done-criteria verification
│   ├── merge-worktree/    ← consensus-loop:merge — squash merge worktree results
│   ├── planner/           ← consensus-loop:planner — planning + work breakdown
│   └── consensus-loop/    ← consensus-loop:guide — evidence package guide
│
├── agents/
│   ├── implementer.md     ← Headless worker (worktree isolation, Sonnet)
│   └── scout.md           ← Read-only RTM generator (3-way traceability, Opus)
│
├── scripts/               ← Deterministic tools + MCP server
│   ├── mcp-server.mjs     ← MCP server: 7 tools (code_map, dependency_graph, audit_scan, coverage_map, rtm_parse, rtm_merge, audit_history)
│   ├── code-map.mjs       ← Symbol index generator
│   ├── audit-scan.mjs     ← Pattern scanner
│   ├── coverage-mapper.mjs← Coverage → RTM mapper
│   ├── enforcement.mjs    ← Structural enforcement (upstream delay, tech debt, FP detection)
│   └── add-locale-key.mjs ← Locale key helper
│
├── commands/              ← CLI commands (auto-discovered)
│
├── context.mjs            ← Shared module: config, paths, parsers, i18n cache
├── index.mjs              ← PostToolUse hook entry point
├── audit.mjs              ← Runs GPT/Codex audit when trigger_tag detected
├── respond.mjs            ← Syncs claude.md ↔ gpt.md, promotes/demotes tags
├── retrospective.mjs      ← Sets retro marker after all items agreed
├── session-gate.mjs       ← PreToolUse hook: blocks Bash until retro complete
├── session-start.mjs      ← SessionStart hook: handoff sync + resume + context reinforcement
├── session-stop.mjs       ← Stop hook: handoff sync + auto-commit
├── subagent-stop.mjs      ← SubagentStop hook: worker completion + deferred retro
├── pre-compact.mjs        ← PreCompact hook: state snapshot before compaction
├── cli-runner.mjs         ← Cross-platform binary resolver
├── handoff-writer.mjs     ← Bidirectional repo ↔ memory handoff sync
├── i18n.mjs               ← Standalone locale helper
│
├── locales/
├── templates/
│   ├── audit-prompt.md    ← Facade (~30 lines) → references
│   ├── fix-prompt.md      ← Facade → references
│   ├── retro-prompt.md    ← Facade → references
│   └── references/{ko,en}/  ← 10 team policy files × 2 languages
│
├── tests/                ← Plugin unit/integration tests (Node.js built-in runner)
├── test-harness/         ← Isolated TypeScript project for full-cycle validation (44 tests, 10 scenarios)
├── plans/
├── examples/
│
└── (auto-generated — gitignored)
    Written to REPO_ROOT/.claude/:
    ├── audit.lock         ← Background audit PID + TTL (prevents concurrent runs)
    ├── audit-bg.log       ← Real-time streaming log from background audit
    └── audit-debounce.ts  ← Debounce timestamp for consecutive edits
    Plugin-local:
    ├── config.json
    ├── .session-state/    ← retro-marker.json
    ├── debug.log
    └── codex-session.log
```

---

## How It Works

```
Code Edit → PostToolUse hook
    │
    ├─ watch_file + trigger_tag? → audit.mjs → gpt.md → respond.mjs
    │                    ┌─── [agree_tag] → retro marker → session-gate blocks
    │                    │       → HITL retro → complete → commit allowed
    │                    └─── [pending_tag] → --auto-fix → correction
    │
    ├─ gpt.md newer? → respond.mjs (auto-sync)
    ├─ planning file? → respond.mjs --gpt-only
    └─ quality rule? → run command (ESLint, npm audit, …)
```

---

## Session Gate (HITL)

`session-gate.mjs` PreToolUse hook enforces retrospective completion:

- **Marker set** → Bash/Agent blocked, Read/Write/Edit allowed
- **Session-aware** → only blocks the session that completed the audit
- **Completion** → `echo session-self-improvement-complete`
- **Fail-open** → errors pass through silently

---

## Facade Pattern

Prompt templates are lean facades (~30 lines) referencing policy files:

```
audit-prompt.md → references/{{LOCALE}}/rejection-codes.md
                → references/{{LOCALE}}/test-checklist.md
                → references/{{LOCALE}}/output-format.md
                → references/{{LOCALE}}/principles.md
```

**To change audit criteria**: edit `references/en/rejection-codes.md`. No code changes needed.

---

## Shared Module (context.mjs)

Single source for all scripts: config (1 parse), memoized paths, tag constants, 16 markdown parsers, cached i18n.

---

## Quick Setup

### Option A: Claude Code Plugin (Recommended)

```bash
claude plugin marketplace add berrzebb/claude-plugins
claude plugin install consensus-loop@berrzebb-plugins
```

All hooks (`SessionStart`, `Stop`, `PreToolUse`, `PostToolUse`, `SubagentStop`, `PreCompact`) and skills are registered automatically.

### Option B: Local Development (`--plugin-dir`)

```bash
claude --plugin-dir .claude/hooks/consensus-loop
```

After modifying source files, clear cache: `rm -rf ~/.claude/plugins/cache/consensus-loop`

### Option C: Manual Setup (Legacy)

1. Copy `consensus-loop/` into `.claude/hooks/`
2. Register hooks in `.claude/settings.local.json` (SessionStart, PreToolUse, PostToolUse, Stop)
3. Copy and edit `config.json`
4. Copy and edit `templates/` + `references/`

---

## Template Variables

| Variable | Used in | Resolved to |
|---|---|---|
| `{{SCOPE}}` | audit | Audit scope |
| `{{CLAUDE_MD_PATH}}` / `{{GPT_MD_PATH}}` | all | Absolute paths |
| `{{TRIGGER_TAG}}` / `{{AGREE_TAG}}` / `{{PENDING_TAG}}` | all | Tag values |
| `{{LOCALE}}` | all | Current locale (ko/en) |
| `{{CORRECTIONS}}` | fix | GPT corrections |
| `{{AGREED_ITEMS}}` | retro | Agreed items |

---

## Environment Variables

| Variable | Description |
|---|---|
| `FEEDBACK_LOOP_ACTIVE=1` | Reentrance guard |
| `CODEX_BIN` / `CLAUDE_BIN` | CLI path overrides |
| `RETRO_SESSION_ID` | Session ID for retro marker |
