# Consensus Loop — Plugin Reference

> Status: `active` | Scope: `.claude/hooks/consensus-loop`

A self-contained PostToolUse hook plugin that implements a **tag-based two-party consensus protocol** between Claude and an external auditor (GPT/Codex).

The goal is not to build a general webhook system, but to give the edit–audit–agree cycle a stable, config-driven home so that any project can adopt it by copying one directory and adjusting `config.json`.

---

## Folder Structure

```
consensus-loop/
├── index.mjs              ← PostToolUse hook entry point
├── audit.mjs              ← runs GPT/Codex audit when trigger_tag detected
├── respond.mjs            ← syncs claude.md ↔ gpt.md, promotes agreed items
├── retrospective.mjs      ← post-consensus retrospective runner (claude -p)
├── cli-runner.mjs         ← resolves CLI binary paths (Windows + Linux)
├── i18n.mjs               ← locale helper (loads locales/*.json, {var} substitution)
│
├── locales/
│   ├── en.json            ← English UI strings for all scripts
│   └── ko.json            ← Korean UI strings
│
├── templates/             ← active prompt templates (gitignored — edit to customize)
│   ├── audit-prompt.md    ← system prompt sent to GPT during audit
│   ├── fix-prompt.md      ← fix instruction sent to Claude after rejection
│   └── retro-prompt.md    ← reflection prompt sent to Claude after full consensus
│
├── docs/
│   ├── en/README.md       ← this file
│   └── ko/README.md       ← Korean version
│
├── tests/
│   └── cl1-verify.test.mjs  ← CL-1 unit tests (find_respond_file, singleRe)
│
├── examples/              ← reference material; copy and adapt
│   ├── config.example.json          ← full annotated config reference
│   ├── plans/
│   │   ├── en/
│   │   │   ├── execution-order.example.md   ← global task execution order
│   │   │   ├── work-catalog.example.md      ← track/task catalog
│   │   │   ├── work-breakdown.md            ← item-level breakdown format
│   │   │   └── sample-track/
│   │   └── ko/                              ← Korean equivalents
│   └── templates/
│       ├── en/
│       │   ├── audit-prompt.example.md  ← starting point for audit-prompt.md
│       │   ├── fix-prompt.example.md    ← starting point for fix-prompt.md
│       │   └── retro-prompt.example.md  ← starting point for retro-prompt.md
│       └── ko/                          ← Korean equivalents
│
└── (project-specific — gitignored)
    ├── config.json        ← your live config (copy from examples/config.example.json)
    ├── feedback/          ← your live feedback files (claude.md, gpt.md)
    ├── plans/             ← your active planning documents
    ├── ack.timestamp      ← GPT ack dedup guard (auto-generated)
    ├── session.id         ← current Claude session ID (auto-generated)
    └── debug.log          ← hook run log (auto-generated)
```

---

## Why This Exists

AI produces plausible-but-wrong output. Asking the same AI to review its own work repeats the same blind spots.

This loop enforces three principles:

1. **Independent critic** — Separate the AI that writes (Claude) from the AI that reviews (GPT). The same model cannot reliably catch its own mistakes.
2. **No progress without consensus** — Items tagged `[GPT미검증]` are incomplete until promoted to `[합의완료]`. Unverified changes do not accumulate.
3. **Reflexion at every iteration end** — After consensus, record what went well, what failed, and what to improve. Lessons persist via `feedback/*.md` and are injected into the next session's context — making the AI better without retraining.

The consensus loop is the infrastructure that makes this discipline automatic rather than voluntary.

---

## How It Works

```
PostToolUse (any file edit)
        │
        ▼
   index.mjs
        │
        ├─ watch_file edited + trigger_tag present?
        │       └─→ audit.mjs  (send to GPT, write gpt.md)
        │
        ├─ gpt.md newer than claude.md?
        │       └─→ respond.mjs  (parse gpt.md, promote/demote tags in claude.md)
        │
        ├─ planning file edited?
        │       └─→ respond.mjs --gpt-only  (normalize pass only)
        │
        └─ quality rule matches edited file?
                └─→ run configured command (ESLint, npm audit, …)
```

---

## Quick Setup

**1. Copy the plugin directory into your project:**

```
cp -r consensus-loop  <your-repo>/.claude/hooks/
```

**2. Register the hook in `.claude/settings.local.json`:**

```json
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "node .claude/hooks/consensus-loop/index.mjs" }] }
    ]
  }
}
```

**3. Copy and edit config:**

```
cp examples/config.example.json config.json
```

Adjust `consensus.watch_file`, `consensus.trigger_tag`, `consensus.agree_tag`, `consensus.pending_tag`, and `consensus.planning_dirs` for your project.

**4. Copy and edit prompt templates:**

```
cp examples/templates/en/audit-prompt.example.md templates/audit-prompt.md
cp examples/templates/en/fix-prompt.example.md   templates/fix-prompt.md
cp examples/templates/en/retro-prompt.example.md templates/retro-prompt.md
```

---

## Config Reference

```jsonc
{
  "plugin": {
    // Filenames only — resolved relative to the plugin directory
    "locale":          "en",
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
    // Repo-scoped paths — resolved relative to the repository root
    "watch_file":      "feedback/claude.md",   // Claude's file; edits here drive the loop
    "trigger_tag":     "[REVIEW_NEEDED]",       // tag that fires audit
    "agree_tag":       "[APPROVED]",            // tag that marks consensus reached
    "pending_tag":     "[CHANGES_REQUESTED]",   // tag that marks item on hold
    "planning_files":  [],                      // explicit file list (repo-root relative)
    "planning_dirs":   ["docs/en/design/improved"], // no leading slash — repo-root relative
    "design_docs_dir": "docs/en/design/**",     // glob for read-only design docs
    "sections": { /* heading names in your feedback files — see config.example.json */ },
    "doc_patterns":  { /* text fragments used when writing sections — see config.example.json */ }
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

## Planning Document Layout

When managing a multi-track project, mirror the structure under `examples/plans/`:

```
plans/                         ← repo-scoped planning dir (add to planning_dirs)
  en/
    execution-order.md         ← ordered list of all tracks / milestones
    work-catalog.md            ← one-line summary per track
    <track-name>/
      README.md                ← design doc (purpose, scope, completion criteria)
      work-breakdown.md        ← item-level tasks (ST-1, ST-2, …)
  ko/                          ← Korean mirror (same structure)
```

The hook treats every file under `planning_dirs` as a planning document — edits trigger a GPT normalize pass that keeps formatting consistent without running a full audit.

---

## Prompt Template Variables

**`templates/audit-prompt.md`** — injected by `audit.mjs`:

| Variable | Resolved to |
|---|---|
| `{{SCOPE}}` | Audit scope (auto-detected or `--scope` override) |
| `{{PROMOTION_SECTION}}` | Next promotion candidate block (empty if none) |
| `{{CLAUDE_MD_PATH}}` | Absolute path to `watch_file` |
| `{{GPT_MD_PATH}}` | Absolute path to `gpt.md` |
| `{{TRIGGER_TAG}}` | Value of `consensus.trigger_tag` |
| `{{AGREE_TAG}}` | Value of `consensus.agree_tag` |
| `{{PENDING_TAG}}` | Value of `consensus.pending_tag` |
| `{{DESIGN_DOCS_DIR}}` | Value of `consensus.design_docs_dir` |

**`templates/fix-prompt.md`** — injected by `respond.mjs`:

| Variable | Resolved to |
|---|---|
| `{{CORRECTIONS}}` | Bullet list of GPT corrections |
| `{{REJECT_CODES}}` | Rejection reason codes from `gpt.md` |
| `{{RESET_CRITERIA}}` | Reset criteria from `gpt.md` |
| `{{NEXT_TASKS}}` | Next task list from `gpt.md` |
| `{{GPT_MD}}` | Full raw content of `gpt.md` |
| `{{CLAUDE_MD_PATH}}` | Absolute path to `watch_file` (also `{{WATCH_FILE}}`) |
| `{{GPT_MD_PATH}}` | Absolute path to `gpt.md` (also `{{RESPOND_FILE}}`) |
| `{{TRIGGER_TAG}}` | Value of `consensus.trigger_tag` |
| `{{AGREE_TAG}}` | Value of `consensus.agree_tag` |
| `{{PENDING_TAG}}` | Value of `consensus.pending_tag` |
| `{{DESIGN_DOCS_DIR}}` | Value of `consensus.design_docs_dir` |

**`templates/retro-prompt.md`** — injected by `retrospective.mjs`:

| Variable | Resolved to |
|---|---|
| `{{CLAUDE_MD_PATH}}` | Absolute path to `watch_file` |
| `{{RX_ID}}` | Retrospective identifier (e.g. `RX-003`) |
| `{{AGREED_ITEMS}}` | List of items that just reached `agree_tag` |
| `{{TRIGGER_TAG}}` | Value of `consensus.trigger_tag` |
| `{{AGREE_TAG}}` | Value of `consensus.agree_tag` |
| `{{PENDING_TAG}}` | Value of `consensus.pending_tag` |

---

## Out of Scope

- Swapping the audit model — change `plugin.audit_script` in config
- Web UI or dashboard
- Audit history beyond `session.id` and `debug.log`
