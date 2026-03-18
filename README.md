# consensus-loop v2.1.0

> **Claude Code hook plugin** — tag-based two-party consensus protocol between Claude (implementer) and an external AI auditor (GPT/Codex), with HITL retrospective gates and multi-agent orchestration.

Drop in one directory, edit one `config.json`, and every file edit is automatically routed through an **edit → audit → agree → retro → commit** cycle. Supports multi-agent orchestration with headless workers running in isolated git worktrees.

---

## Why This Exists

1. **Independent critic** — The AI that writes (Claude) and the AI that reviews (GPT/Codex) are different models.
2. **No progress without consensus** — `[trigger_tag]` items are incomplete until promoted to `[agree_tag]`.
3. **Auto retrospective** — After consensus, the session gate blocks commits and the AI agent automatically starts the retrospective (no user instruction needed).
4. **Policy as data** — Audit criteria, rejection codes, and output formats are defined in editable reference files, not code.

---

## Key Features

| Feature | Description |
|---|---|
| **Consensus loop** | `trigger_tag` in `watch_file` → `audit.mjs` → waits for `agree_tag` |
| **Async audit** | Hook spawns audit as a detached background process → returns immediately (no blocking) |
| **Streaming output** | Codex NDJSON events are parsed line-by-line in real-time → `audit-bg.log` |
| **Auto-sync** | `gpt.md` newer than `watch_file` → `respond.mjs` promotes/demotes tags |
| **Quality gates** | Every file edit → matching `quality_rules` run inline (ESLint, npm audit, …) |
| **Session gate (auto-retro)** | PreToolUse hook blocks Bash/commit → AI auto-starts retrospective |
| **Facade prompts** | Lean prompts (~30 lines) reference `{{REFERENCES_DIR}}/` for detailed rules |
| **Shared context** | `context.mjs` — single source for config, paths, parsers, i18n (no duplication) |
| **Locale allowlist** | `plugin.locale` validated against `{"en","ko"}` allowlist — invalid values fall back to `"en"` (path traversal prevention) |
| **Audit timestamp** | System-appended `> 감사 완료: YYYY-MM-DD HH:MM` on gpt.md (zero agent tokens) |
| **Debounce** | Rapid consecutive edits are debounced (10 s) — only the last edit triggers an audit |
| **Audit lock** | `audit.lock` in `REPO_ROOT/.claude/` prevents concurrent audits (TTL + PID liveness) |
| **Session lifecycle** | `SessionStart` / `Stop` hooks manage session ID and cleanup |
| **Subagent tracking** | `SubagentStop` hook captures implementer agent results |
| **Handoff sync** | `handoff-writer.mjs` — bidirectional sync between repo handoff doc and Claude memory |
| **Plugin skills** | 6 slash-command skills: `consensus-loop:orchestrator`, `consensus-loop:implementer`, `consensus-loop:verify`, `consensus-loop:merge`, `consensus-loop:planner`, `consensus-loop:guide` |
| **CLI commands** | 2 slash commands: `/consensus-audit` (manual audit), `/consensus-status` (current state) |
| **Codex session log** | `codex-session.log` / `audit-bg.log` — Codex output recorded for debugging |
| **Hook toggles** | `plugin.hooks_enabled` — individually disable audit, session_gate, quality_rules, pre_compact |
| **PreCompact snapshot** | Saves audit state (retro-marker, audit.lock, last item) before context compaction |
| **Resume detection** | SessionStart auto-detects 7 interrupted states → provides specific resume instructions |
| **Context reinforcement** | SessionStart re-injects AI-GUIDE "absolute rules" via `<CONTEXT-REINFORCEMENT>` tag |

---

## Folder Structure

```
consensus-loop/
│
├── .claude-plugin/
│   └── plugin.json        ← Plugin metadata (name, version, author)
│
├── hooks/
│   └── hooks.json         ← Hook event registration (auto-discovered by plugin system)
│
├── skills/                ← Slash-command skills (auto-discovered, prefix: consensus-loop:)
│   ├── orchestrator/      ← consensus-loop:orchestrator — multi-track distribution + agent registry
│   ├── implementer/       ← consensus-loop:implementer — headless worker (worktree, SendMessage corrections)
│   ├── verify-implementation/ ← consensus-loop:verify — done-criteria verification
│   ├── merge-worktree/    ← consensus-loop:merge — squash merge worktree results
│   ├── planner/           ← consensus-loop:planner — planning + work breakdown
│   └── consensus-loop/    ← consensus-loop:guide — evidence package guide
│
├── agents/
│   └── implementer.md     ← Implementer agent persona
│
├── commands/              ← CLI commands (auto-discovered)
│   ├── consensus-audit.md ← /consensus-audit — trigger manual audit
│   └── consensus-status.md← /consensus-status — show current loop state
│
├── docs/                  ← User-facing documentation
│   ├── en/
│   │   ├── AI-GUIDE.md    ← AI agent usage guide (English)
│   │   ├── README.md      ← Plugin reference (English)
│   │   └── ROADMAP.md     ← Roadmap
│   └── ko/
│       ├── AI-GUIDE.md    ← AI agent usage guide (Korean)
│       └── README.md      ← Plugin reference (Korean)
│
├── context.mjs            ← Shared module: config, paths, parsers, i18n cache, safeLocale
├── index.mjs              ← PostToolUse hook entry point
├── audit.mjs              ← Runs GPT/Codex audit when trigger_tag detected
├── respond.mjs            ← Syncs gpt.md ↔ claude.md; promotes/demotes tags
├── retrospective.mjs      ← Sets retro marker after all items agreed
├── session-gate.mjs       ← PreToolUse hook: blocks Bash until retro complete
├── pre-compact.mjs        ← PreCompact hook: saves audit state before context compaction
├── session-start.mjs      ← SessionStart hook: handoff sync + resume detection + context reinforcement
├── session-stop.mjs       ← Stop hook: handoff sync + auto-commit
├── subagent-stop.mjs      ← SubagentStop hook: detects worker completion + deferred retro
├── CLAUDE.md              ← AI agent context (module map, gotcha, config reference)
├── handoff-writer.mjs     ← Handoff sync between repo and Claude memory (portable)
├── cli-runner.mjs         ← Cross-platform binary resolver (sync + async spawn)
├── i18n.mjs               ← Standalone locale helper (fallback for non-context imports)
│
├── locales/
│   ├── en.json
│   └── ko.json
│
├── templates/
│   ├── audit-prompt.md    ← Facade (~30 lines) → references policy files
│   ├── fix-prompt.md      ← Facade → references fix-rules, evidence-format
│   ├── retro-prompt.md    ← Facade → references retro-questions, memory-cleanup
│   └── references/
│       ├── ko/            ← Korean policy files (team-editable, 9 files)
│       │   ├── rejection-codes.md
│       │   ├── test-checklist.md
│       │   ├── output-format.md
│       │   ├── evidence-format.md
│       │   ├── done-criteria.md
│       │   ├── memory-cleanup.md
│       │   ├── principles.md
│       │   ├── retro-questions.md
│       │   └── fix-rules.md
│       └── en/            ← English equivalents (same 9 files)
│
├── tests/
├── plans/                 ← Work planning docs (ko/en)
├── examples/              ← Example config, plans, templates, and references
│   ├── config.example.json
│   ├── plans/             ← Example execution-order, work-catalog, sample-track
│   └── templates/
│       ├── {ko,en}/       ← Example audit/fix/retro prompts
│       └── references/
│           ├── ko/        ← Example Korean policy files (9 × .example.md)
│           └── en/        ← Example English policy files (9 × .example.md)
│
└── (auto-generated — gitignored, written to REPO_ROOT/.claude/)
    ├── audit.lock              ← Background audit PID + TTL (prevents concurrent runs)
    ├── audit-bg.log            ← Real-time streaming log from background audit
    ├── audit-debounce.ts       ← Debounce timestamp for consecutive edits
    └── compaction-snapshot.json ← PreCompact state snapshot (restored on SessionStart)
    (plugin-local — gitignored within plugin dir)
    ├── config.json
    ├── .session-state/    ← retro-marker.json (session gate state)
    ├── ack.timestamp
    ├── session.id
    ├── debug.log
    └── codex-session.log
```

---

## How It Works

### Multi-Agent Lifecycle

```
consensus-loop:planner ─── Track definition + execution plan adjustment
    ↓
consensus-loop:orchestrator ─── Select WBs → scope validation → parallel distribute
    ↓                                        (non-overlapping files only)
┌─── Track A (worktree) ──────┐  ┌─── Track B (worktree) ──────┐
│  implementer: implement      │  │  implementer: implement      │
│  → consensus-loop:verify     │  │  → consensus-loop:verify     │
│  → submit evidence           │  │  → submit evidence           │
│  [pending_tag] → SendMessage │  │  [agree_tag] → WIP commit   │
│  → correction → resubmit    │  │                               │
│  [agree_tag] → WIP commit   │  │                               │
└──────────────────────────────┘  └──────────────────────────────┘
    ↓ (all tracks: agree_tag + WIP commit)
orchestrator resumes (per-track)
    ↓
Retrospective protocol (session-gate blocks Bash/Agent)
    → memory cleanup + principles update
    → "session-self-improvement-complete" → gate release
    ↓
/merge-worktree → squash merge → single structured commit
    ↓
Write session handoff → select next WB → loop
```

### Hook Cycle (PostToolUse)

```
Code Edit → PostToolUse hook (index.mjs)
    │
    ├─ watch_file + trigger_tag?
    │       │
    │       ├─ audit.lock exists? → skip (already running)
    │       └─ spawn audit.mjs (detached, background)
    │              → hook returns immediately
    │              → audit-bg.log streams real-time output
    │              → audit.lock created (PID + TTL)
    │              → agent auto-registers Cron watcher
    │
    │   ... audit runs in background (Codex review) ...
    │
    │       audit.mjs completes:
    │              → gpt.md created/updated
    │              → respond.mjs (tag sync)
    │              → audit.lock deleted
    │              ↓
    │   [Detection: Cron watcher OR next PostToolUse]
    │              ↓
    │    ┌─── [agree_tag] ───── implementer WIP commit
    │    │                           ↓
    │    │                    retrospective.mjs → retro-marker set
    │    │                           ↓
    │    │                    session-gate blocks Bash
    │    │                           ↓
    │    │                    orchestrator: HITL retrospective
    │    │                           ↓
    │    │                    echo session-self-improvement-complete
    │    │                           ↓
    │    │                    orchestrator: /consensus-loop:merge → squash commit
    │    │                           ↓
    │    │                    orchestrator: write handoff → next WB
    │    │
    │    └─── [pending_tag] → respond.mjs --auto-fix → correction
    │
    ├─ gpt.md newer? → respond.mjs (auto-sync)
    ├─ planning file? → respond.mjs --gpt-only
    └─ quality rule? → run command (ESLint, npm audit, …)
```

### Session Gate (HITL)

The `session-gate.mjs` PreToolUse hook enforces retrospective completion:

- **Marker set** → Bash/Agent blocked, Read/Write/Edit allowed (for memory work)
- **Session-aware** → only blocks the session that completed the audit (other sessions unaffected)
- **Completion** → `echo session-self-improvement-complete` clears marker
- **Fail-open** → errors pass through silently (never locks the system)

---

## Facade Pattern for Prompts

Prompt templates are lean facades (~30 lines) that reference policy files:

```
audit-prompt.md (30 lines)
  → {{REFERENCES_DIR}}/rejection-codes.md
  → {{REFERENCES_DIR}}/test-checklist.md
  → {{REFERENCES_DIR}}/output-format.md
```

`{{REFERENCES_DIR}}` resolves to the correct path relative to repo root at runtime (e.g., `.claude/hooks/consensus-loop/templates/references/ko/`).

**To change audit criteria**: edit `references/ko/rejection-codes.md`. No code changes needed.

---

## Installation

### Option A: Claude Code Plugin (Recommended)

Add the marketplace, then install the plugin:

```bash
claude marketplace add berrzebb/berrzebb-plugins
claude plugin add consensus-loop@berrzebb-plugins
```

This automatically registers all hooks (`SessionStart`, `Stop`, `PreToolUse`, `PostToolUse`, `SubagentStop`, `PreCompact`) and makes skills available as slash commands.

### Option B: Local Development (`--plugin-dir`)

For local development or testing before publishing:

```bash
claude --plugin-dir .claude/hooks/consensus-loop
```

The plugin system caches files to `~/.claude/plugins/cache/`. After modifying source files, clear the cache to pick up changes:

```bash
rm -rf ~/.claude/plugins/cache/consensus-loop
```

### Option C: Manual Setup (Legacy)

**1. Copy into your project:**

```
cp -r consensus-loop  <your-repo>/.claude/hooks/
```

**2. Register hooks in `.claude/settings.local.json`:**

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node .claude/hooks/consensus-loop/session-start.mjs" }] }
    ],
    "PreToolUse": [
      { "hooks": [{ "type": "command", "command": "node .claude/hooks/consensus-loop/session-gate.mjs", "timeout": 10000 }] }
    ],
    "PostToolUse": [
      { "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "node .claude/hooks/consensus-loop/index.mjs", "timeout": 30000 }] }
    ],
    "PreCompact": [
      { "hooks": [{ "type": "command", "command": "node .claude/hooks/consensus-loop/pre-compact.mjs", "timeout": 5000 }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node .claude/hooks/consensus-loop/session-stop.mjs", "async": true, "timeout": 120 }] }
    ]
  }
}
```

**3. Copy and edit config:**

```
cp .claude/hooks/consensus-loop/examples/config.example.json \
   .claude/hooks/consensus-loop/config.json
```

**4. Copy prompt templates + references:**

```
cp -r .claude/hooks/consensus-loop/examples/templates/ \
      .claude/hooks/consensus-loop/templates/
```

Adjust tags, file paths, and reference policies for your project.

**5. Tell your AI agent about the consensus loop:**

Add the following to your project's `CLAUDE.md` (or equivalent AI instructions file):

```markdown
## Consensus Loop

This project uses a cross-model audit gate. Read the AI agent guide before submitting evidence:
- Korean: `.claude/hooks/consensus-loop/docs/ko/AI-GUIDE.md`
- English: `.claude/hooks/consensus-loop/docs/en/AI-GUIDE.md`
```

This ensures the AI agent understands the evidence format, tag rules, async audit behavior, and retrospective protocol.

---

## Config Reference

```jsonc
{
  "plugin": {
    "locale":          "en",                         // Allowlist: "en" | "ko" only — other values silently fall back to "en"
    "audit_script":    "audit.mjs",
    "audit_prompt":    "templates/audit-prompt.md",
    "respond_script":  "respond.mjs",
    "fix_prompt":      "templates/fix-prompt.md",
    "respond_file":    "gpt.md",
    "retro_script":    "retrospective.mjs",
    "retro_prompt":    "templates/retro-prompt.md",
    "ack_file":        "ack.timestamp",
    "session_file":    "session.id",
    "debug_log":       "debug.log",
    "hooks_enabled": {                       // Toggle individual hooks (all default true)
      "audit": true,                         // Audit trigger on watch_file edit
      "session_gate": true,                  // Retro enforcement gate
      "quality_rules": true,                 // Per-file quality checks
      "pre_compact": true                    // State snapshot before compaction
    }
  },
  "consensus": {
    "watch_file":      "feedback/claude.md",
    "trigger_tag":     "[GPT미검증]",
    "agree_tag":       "[합의완료]",
    "pending_tag":     "[계류]",
    "planning_dirs":   ["docs/ko/design/improved"],
    "sections": { ... },
    "doc_patterns": { ... }
  },
  "quality_rules": [ ... ]
}
```

> **Security note**: `quality_rules[].command` values are executed via the system shell (`shell: true`). Never use a `config.json` from an untrusted source — a malicious command field can execute arbitrary code on your machine.

---

## Template Variables

### `audit-prompt.md`

| Variable | Resolved to |
|---|---|
| `{{SCOPE}}` | Audit scope (auto-detected or `--scope`) |
| `{{PROMOTION_SECTION}}` | Next promotion candidate block |
| `{{CLAUDE_MD_PATH}}` | Absolute path to watch_file |
| `{{GPT_MD_PATH}}` | Absolute path to gpt.md |
| `{{TRIGGER_TAG}}` / `{{AGREE_TAG}}` / `{{PENDING_TAG}}` | Tag values |
| `{{DESIGN_DOCS_DIR}}` | Read-only design docs glob |
| `{{LOCALE}}` | Current locale (ko/en) |
| `{{REFERENCES_DIR}}` | Absolute path to `templates/references/{locale}/` from repo root |

### `fix-prompt.md`

| Variable | Resolved to |
|---|---|
| `{{CORRECTIONS}}` | GPT correction list |
| `{{REJECT_CODES}}` | Rejection codes |
| `{{RESET_CRITERIA}}` | Reset criteria |
| `{{NEXT_TASKS}}` | Next task list |
| `{{GPT_MD}}` | Full gpt.md content |
| `{{LOCALE}}` | Current locale |
| `{{REFERENCES_DIR}}` | Path to `templates/references/{locale}/` from repo root |

### `retro-prompt.md`

| Variable | Resolved to |
|---|---|
| `{{AGREED_ITEMS}}` | Recently agreed items |
| `{{LOCALE}}` | Current locale |
| `{{REFERENCES_DIR}}` | Path to `templates/references/{locale}/` from repo root |

---

## Environment Variables

| Variable | Description |
|---|---|
| `FEEDBACK_LOOP_ACTIVE=1` | Reentrance guard (auto-set in child processes) |
| `FEEDBACK_HOOK_DRY_RUN=1` | Dry-run mode |
| `CODEX_BIN` | Override Codex CLI path |
| `CLAUDE_BIN` | Override Claude CLI path |
| `RETRO_SESSION_ID` | Session ID propagated to retro marker |
| `VITEST_SHARD` | When set, coverage thresholds are disabled |

---

## Porting to Another Project

1. `claude marketplace add berrzebb/berrzebb-plugins && claude plugin add consensus-loop@berrzebb-plugins` (or copy into `.claude/hooks/`)
2. Edit `config.json` — set tags, paths, quality rules
3. Edit `templates/references/{locale}/` — set team policies
4. (Manual only) Register hooks in `.claude/settings.local.json`

Example for English:

```json
{
  "watch_file": "docs/review/author.md",
  "trigger_tag": "[REVIEW_NEEDED]",
  "agree_tag": "[APPROVED]",
  "pending_tag": "[CHANGES_REQUESTED]"
}
```

---

## Contributors

| Contributor | Contributions |
|---|---|
| [@berrzebb](https://github.com/berrzebb) | Core architecture, async audit, streaming, i18n, HITL gate |
| [@dandacompany](https://github.com/dandacompany) | Security fixes (#1 shell injection, #2 plugin support), v5 locale path traversal + ESM require fix |
