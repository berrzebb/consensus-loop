# consensus-loop

> **Claude Code PostToolUse hook** — a self-contained plugin that enforces a **tag-based two-party consensus protocol** between Claude and an external AI auditor (GPT/Codex).

Drop in one directory, edit one `config.json`, and every file edit you make is automatically routed through an edit → audit → agree cycle.

---

## Why This Exists

AI produces plausible-but-wrong output. Asking the same AI to review its own work repeats the same blind spots.

This loop enforces three principles:

1. **Independent critic** — The AI that writes (Claude) and the AI that reviews (GPT) are different models. The same model cannot reliably catch its own mistakes.
2. **No progress without consensus** — Items tagged `[GPT미검증]` are incomplete until promoted to `[합의완료]`. Unverified changes do not accumulate.
3. **Reflexion at every iteration end** — After consensus, record what went well, what failed, and what to improve. Lessons are injected into the next session's context — improving the AI without retraining.

The consensus loop makes this discipline automatic rather than voluntary.

---

## Key Features

| Feature | Description |
|---|---|
| **Consensus loop** | `trigger_tag` in `watch_file` → runs `audit_script` → waits for `agree_tag` |
| **Auto-sync** | When `gpt.md` is newer than `watch_file`, `respond_script` promotes/demotes tags automatically |
| **Quality gates** | On every file edit, matching `quality_rules` run inline (ESLint, npm audit, …) |
| **Planning normalization** | Edits to `planning_dirs` files trigger a GPT normalize pass without a full audit |
| **Retrospective** | After all items reach `agree_tag`, `retrospective.mjs` runs a three-question reflection cycle |

---

## Folder Structure

```
consensus-loop/
│
├── index.mjs              ← PostToolUse hook entry point
├── audit.mjs              ← Runs GPT/Codex audit when trigger_tag is detected
├── respond.mjs            ← Syncs gpt.md → claude.md; promotes/demotes status tags
├── cli-runner.mjs         ← Cross-platform binary resolver (Windows + Linux)
├── i18n.mjs               ← Locale helper (loads locales/*.json, {var} substitution)
├── retrospective.mjs      ← Post-consensus retrospective runner (claude -p)
│
├── locales/
│   ├── en.json            ← English UI strings for all scripts
│   └── ko.json            ← Korean UI strings
│
├── docs/
│   ├── en/README.md       ← Full plugin reference (English)
│   └── ko/README.md       ← Full plugin reference (Korean)
│
├── examples/
│   ├── plans/
│   │   ├── config.example.json        ← Annotated full config reference
│   │   ├── en/                        ← Example planning document structure
│   │   └── ko/                        ← Korean equivalents
│   └── templates/
│       ├── en/                        ← Starting points for audit-prompt.md / fix-prompt.md
│       └── ko/
│
└── (project-specific — gitignored)
    ├── config.json        ← Your live config (copy from examples/plans/config.example.json)
    ├── templates/         ← Your active prompt templates
    ├── feedback/          ← Your live feedback files (claude.md, gpt.md)
    ├── plans/             ← Your active planning documents
    ├── ack.timestamp      ← GPT ack dedup guard (auto-generated)
    ├── session.id         ← Current audit session ID (auto-generated)
    └── debug.log          ← Hook run log (auto-generated)
```

---

## Scripts

### `index.mjs` — Hook Entry Point

Receives the PostToolUse JSON payload from Claude Code via stdin and dispatches to the appropriate handler:

- **(A)** `watch_file` edited + `trigger_tag` present → calls `audit.mjs`
- **(B)** Any other file edited, `gpt.md` newer than `watch_file` → calls `respond.mjs`
- **(C)** Edited file matches a `quality_rule` → runs the configured command inline (ESLint, npm audit, …)
- **(D)** Edited file is under `planning_dirs` → calls `respond.mjs --gpt-only` (normalize pass only)

Reentrance is prevented via the `FEEDBACK_LOOP_ACTIVE` environment variable.

---

### `audit.mjs` — Audit Runner

Sends the watch file contents to the Codex CLI for independent review. Manages the audit session lifecycle:

- Detects pending items (`trigger_tag` / `pending_tag`) and extracts audit scope automatically
- Resumes an existing Codex session or starts a new one (`--resume-last`, `--no-resume`, `--session-id`)
- Writes the thread ID to `session.id` for continuity across invocations
- Resets the session when all items reach `agree_tag`
- Pre-checks ESLint coverage consistency between "changed files" and "Test Command" sections
- After audit, calls `respond.mjs` to sync the result back into `watch_file`

Key options: `--scope`, `--model`, `--dry-run`, `--auto-fix`, `--no-sync`, `--reset-session`

---

### `respond.mjs` — Tag Sync Engine

Reads `gpt.md` (the auditor's verdict) and updates `watch_file` accordingly:

- **agree_tag items**: promotes the tag directly via file write
- **pending_tag items**: extracts corrections from `gpt.md` and forwards them to `claude -p` for resolution (with `--auto-fix`)
- **`--gpt-only`**: normalizes only `gpt.md` and promotion docs without touching `watch_file`
- Keeps the `## Next Task` section in sync with the planning documents

The promotion engine (`computePromotionState`, `deriveAutoPromotionStage`, `renderPromotionDoc`) reads `feedback-promotion.md` in `planning_dirs` to determine the next bundle to work on.

---

### `cli-runner.mjs` — Binary Resolver

Portable utility that finds CLI executables on both Windows and Linux:

- **`resolveBinary(command, envVarName)`**: checks `envVarName` env-var override first, then searches `PATH`. On Windows, probes `PATHEXT` extensions (`.exe`, `.cmd`, `.bat`, …).
- **`spawnResolved(binary, args, options)`**: wraps `spawnSync` with Windows-specific dispatch — `.cmd/.bat` runs with `shell: true`; `.ps1` delegates to `pwsh` or `powershell`.

---

### `i18n.mjs` — Locale Helper

Minimal locale system used by all scripts:

- **`createT(locale)`**: loads `locales/<locale>.json`, falls back to `en.json` if the target is missing.
- Returns a `t(key, vars)` function that substitutes `{var}` placeholders.
- Locale is set via `plugin.locale` in `config.json` (default: `"en"`).

---

### `retrospective.mjs` — Retrospective Runner

Called by `respond.mjs` after all audit items are promoted to `agree_tag`:

1. Extracts the last 10 agreed items from `watch_file` as context
2. Injects context into `templates/retro-prompt.md`
3. Runs `claude -p` to answer three reflection questions and implement improvements
4. Verifies that an `RX-N` block was written to `watch_file`
5. Triggers `audit.mjs` to start the next audit cycle immediately

---

## How It Works

```
PostToolUse (any file edit)
        │
        ▼
   index.mjs
        │
        ├─ watch_file edited + trigger_tag present?
        │       └─→ audit.mjs  (send to GPT/Codex, write gpt.md)
        │
        ├─ gpt.md newer than watch_file?
        │       └─→ respond.mjs  (parse gpt.md, promote/demote tags)
        │
        ├─ planning file edited?
        │       └─→ respond.mjs --gpt-only  (normalize pass only)
        │
        └─ quality rule matches?
                └─→ run configured command (ESLint, npm audit, …)
```

Status transitions:

```
[trigger_tag]  →  audit.mjs  →  [agree_tag]   (consensus reached)
                              ↘  [pending_tag]  →  respond.mjs --auto-fix  →  correction
```

---

## Quick Setup

**1. Copy the plugin into your project:**

```
cp -r consensus-loop  <your-repo>/.claude/hooks/
```

**2. Register the hook in `.claude/settings.local.json`:**

```json
{
  "hooks": {
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
cp .claude/hooks/consensus-loop/examples/plans/config.example.json \
   .claude/hooks/consensus-loop/config.json
```

Adjust `consensus.watch_file`, `consensus.trigger_tag`, `consensus.agree_tag`, and `consensus.planning_dirs` for your project.

**4. Copy and edit prompt templates:**

```
cp .claude/hooks/consensus-loop/examples/templates/en/audit-prompt.example.md \
   .claude/hooks/consensus-loop/templates/audit-prompt.md

cp .claude/hooks/consensus-loop/examples/templates/en/fix-prompt.example.md \
   .claude/hooks/consensus-loop/templates/fix-prompt.md
```

---

## Config Reference

```jsonc
{
  "plugin": {
    "locale":         "en",              // "en" or "ko"
    "audit_script":   "audit.mjs",       // relative to plugin dir
    "audit_prompt":   "templates/audit-prompt.md",
    "respond_script": "respond.mjs",
    "ack_file":       "ack.timestamp",
    "session_file":   "session.id",
    "debug_log":      "debug.log",
    "fix_prompt":     "templates/fix-prompt.md",
    "respond_file":   "gpt.md"           // auditor output filename
  },
  "consensus": {
    "watch_file":     "feedback/claude.md",  // repo-root relative
    "trigger_tag":    "[GPT미검증]",
    "agree_tag":      "[합의완료]",
    "pending_tag":    "[계류]",
    "planning_files": [],                    // explicit file list
    "planning_dirs":  [".claude/hooks/consensus-loop/plans/ko"]
  },
  "quality_rules": [
    {
      "match": { "extension": ".ts", "path_contains": ["/src/", "/tests/"] },
      "label": "eslint",
      "command": "npx eslint --no-error-on-unmatched-pattern \"{file}\""
    }
  ]
}
```

---

## Porting to Another Project

1. Copy `consensus-loop/` into the project's `.claude/hooks/`
2. Edit `config.json` — set your tags, file paths, and quality rules
3. Register the hook in `.claude/settings.local.json`

The tags and file names are fully configurable. Example for an English-language review workflow:

```json
{
  "watch_file":  "docs/review/author.md",
  "trigger_tag": "[REVIEW_NEEDED]",
  "agree_tag":   "[APPROVED]",
  "pending_tag": "[CHANGES_REQUESTED]"
}
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `FEEDBACK_LOOP_ACTIVE=1` | Reentrance guard — set automatically inside spawned scripts |
| `FEEDBACK_HOOK_DRY_RUN=1` | Dry-run mode — prints what would run without executing `audit_script` |
| `CODEX_BIN` | Override the Codex CLI executable path |
| `CLAUDE_BIN` | Override the Claude CLI executable path |
