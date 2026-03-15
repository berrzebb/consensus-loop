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
├── cli-runner.mjs         ← resolves CLI binary paths (Windows + Linux)
├── config.json            ← your live config (copy from examples/plans/config.example.json)
│
├── templates/             ← active prompt templates (edit to customize)
│   ├── audit-prompt.md    ← system prompt sent to GPT during audit
│   └── fix-prompt.md      ← fix instruction sent to Claude after rejection
│
├── feedback/              ← live feedback files (repo-scoped via consensus.watch_file)
│   ├── claude.md          ← Claude writes here; trigger_tag here fires audit
│   └── gpt.md             ← GPT writes audit results here
│
├── docs/
│   ├── en/README.md       ← this file
│   └── ko/README.md       ← Korean version
│
├── examples/              ← reference material; copy and adapt
│   ├── plans/
│   │   ├── config.example.json          ← full annotated config reference
│   │   ├── en/
│   │   │   ├── execution-order.example.md   ← global task execution order
│   │   │   ├── work-catalog.example.md      ← track/task catalog
│   │   │   ├── work-breakdown.md            ← item-level breakdown format
│   │   │   └── sample-track/
│   │   │       └── README.example.md        ← per-track design document
│   │   └── ko/                              ← Korean equivalents
│   └── templates/
│       ├── en/
│       │   ├── audit-prompt.example.md  ← starting point for audit-prompt.md
│       │   └── fix-prompt.example.md    ← starting point for fix-prompt.md
│       └── ko/                          ← Korean equivalents
│
└── (auto-generated state files — do not edit)
    ├── ack.timestamp      ← GPT ack dedup guard
    ├── session.id         ← current Claude session ID
    └── debug.log          ← hook run log
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
        │       └─→ audit.mjs --planning  (normalize pass only)
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
cp examples/plans/config.example.json config.json
```

Adjust `consensus.watch_file`, `consensus.trigger_tag`, `consensus.agree_tag`, `consensus.pending_tag`, and `consensus.planning_dirs` for your project.

**4. Copy and edit prompt templates:**

```
cp examples/templates/en/audit-prompt.example.md templates/audit-prompt.md
cp examples/templates/en/fix-prompt.example.md   templates/fix-prompt.md
```

---

## Config Reference

```jsonc
{
  "plugin": {
    // Filenames only — resolved relative to the plugin directory
    "audit_script":  "audit.mjs",
    "audit_prompt":  "templates/audit-prompt.md",
    "respond_script": "respond.mjs",
    "ack_file":      "ack.timestamp",
    "session_file":  "session.id",
    "debug_log":     "debug.log",
    "fix_prompt":    "templates/fix-prompt.md"
  },
  "consensus": {
    // Repo-scoped paths — resolved relative to the repository root
    "watch_file":    "feedback/claude.md",   // Claude's file; edits here drive the loop
    "trigger_tag":   "[GPT미검증]",           // tag that fires audit
    "agree_tag":     "[합의완료]",             // tag that marks consensus reached
    "pending_tag":   "[계류]",                // tag that marks item on hold
    "planning_files": [],                    // explicit file list (repo-root relative)
    "planning_dirs":  [                      // all files under these dirs count as planning docs
      ".claude/hooks/consensus-loop/plans/ko"
    ]
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

`templates/audit-prompt.md` and `templates/fix-prompt.md` support these placeholders:

| Variable | Resolved to |
|---|---|
| `{{CORRECTIONS}}` | Bullet list of GPT corrections |
| `{{REJECT_CODES}}` | Rejection reason codes from gpt.md |
| `{{RESET_CRITERIA}}` | Reset criteria from gpt.md |
| `{{NEXT_TASKS}}` | Next task list from gpt.md |
| `{{GPT_MD}}` | Full raw content of gpt.md |
| `{{WATCH_FILE}}` | Path of `consensus.watch_file` |
| `{{RESPOND_FILE}}` | Path of gpt.md |
| `{{TRIGGER_TAG}}` | Value of `consensus.trigger_tag` |

---

## Out of Scope

- Swapping the audit model — change `plugin.audit_script` in config
- Web UI or dashboard
- Audit history beyond `session.id` and `debug.log`
