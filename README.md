# consensus-loop

> **Claude Code hook plugin** — tag-based two-party consensus protocol between Claude (implementer) and an external AI auditor (GPT/Codex), with HITL retrospective gates.

Drop in one directory, edit one `config.json`, and every file edit is automatically routed through an **edit → audit → agree → retro → commit** cycle.

---

## Why This Exists

1. **Independent critic** — The AI that writes (Claude) and the AI that reviews (GPT/Codex) are different models.
2. **No progress without consensus** — `[trigger_tag]` items are incomplete until promoted to `[agree_tag]`.
3. **HITL retrospective** — After consensus, the session gate forces a human-in-the-loop retrospective before commit.
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
| **Session gate (HITL)** | PreToolUse hook blocks Bash/commit until retrospective is complete |
| **Facade prompts** | Lean prompts (~30 lines) reference `{{REFERENCES_DIR}}/` for detailed rules |
| **Shared context** | `context.mjs` — single source for config, paths, parsers, i18n (no duplication) |
| **Audit timestamp** | System-appended `> 감사 완료: YYYY-MM-DD HH:MM` on gpt.md (zero agent tokens) |
| **Audit lock** | `audit.lock` prevents concurrent audits (TTL-based with PID liveness check) |
| **Codex session log** | `codex-session.log` / `audit-bg.log` — Codex output recorded for debugging |

---

## Folder Structure

```
consensus-loop/
│
├── context.mjs            ← Shared module: config, paths, parsers, i18n cache
├── index.mjs              ← PostToolUse hook entry point
├── audit.mjs              ← Runs GPT/Codex audit when trigger_tag detected
├── respond.mjs            ← Syncs gpt.md → claude.md; promotes/demotes tags
├── retrospective.mjs      ← Sets retro marker after all items agreed
├── session-gate.mjs       ← PreToolUse hook: blocks Bash until retro complete
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
│       ├── ko/            ← Korean policy files (team-editable)
│       │   ├── rejection-codes.md
│       │   ├── test-checklist.md
│       │   ├── output-format.md
│       │   ├── evidence-format.md
│       │   ├── memory-cleanup.md
│       │   ├── principles.md
│       │   ├── retro-questions.md
│       │   └── fix-rules.md
│       └── en/            ← English equivalents
│
├── tests/
├── plans/                 ← Example planning docs (ko/en)
├── examples/              ← Example config and templates
│
└── (auto-generated — gitignored)
    ├── config.json
    ├── .session-state/    ← retro-marker.json (session gate state)
    ├── ack.timestamp
    ├── session.id
    ├── audit.lock         ← Background audit PID + TTL (prevents concurrent runs)
    ├── audit-bg.log       ← Real-time streaming log from background audit
    ├── debug.log
    └── codex-session.log
```

---

## How It Works

### Full Cycle

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
    │    ┌─── [agree_tag] ───── retrospective.mjs
    │    │                           ↓
    │    │                    retro-marker set
    │    │                           ↓
    │    │                    session-gate blocks Bash
    │    │                           ↓
    │    │                    HITL retrospective (user + AI)
    │    │                           ↓
    │    │                    echo session-self-improvement-complete
    │    │                           ↓
    │    │                    git commit allowed
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

## Quick Setup

**1. Copy into your project:**

```
cp -r consensus-loop  <your-repo>/.claude/hooks/
```

**2. Register hooks in `.claude/settings.local.json`:**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "hooks": [
          { "type": "command", "command": "node .claude/hooks/consensus-loop/session-gate.mjs", "timeout": 10000 }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "node .claude/hooks/consensus-loop/index.mjs" }
        ]
      }
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

---

## Config Reference

```jsonc
{
  "plugin": {
    "locale":          "en",                         // "en" or "ko"
    "audit_script":    "audit.mjs",
    "audit_prompt":    "templates/audit-prompt.md",
    "respond_script":  "respond.mjs",
    "fix_prompt":      "templates/fix-prompt.md",
    "respond_file":    "gpt.md",
    "retro_script":    "retrospective.mjs",
    "retro_prompt":    "templates/retro-prompt.md",
    "ack_file":        "ack.timestamp",
    "session_file":    "session.id",
    "debug_log":       "debug.log"
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

1. Copy `consensus-loop/` into `.claude/hooks/`
2. Edit `config.json` — set tags, paths, quality rules
3. Edit `templates/references/{locale}/` — set team policies
4. Register hooks in `.claude/settings.local.json`

Example for English:

```json
{
  "watch_file": "docs/review/author.md",
  "trigger_tag": "[REVIEW_NEEDED]",
  "agree_tag": "[APPROVED]",
  "pending_tag": "[CHANGES_REQUESTED]"
}
```
