---
name: consensus-loop:audit
description: "Run a consensus-loop audit manually — Codex reviews pending trigger_tag items in the watch file. Use when you want to trigger an audit without editing the watch file, re-run a failed audit, or test the audit prompt."
argument-hint: "[--dry-run | --no-resume | --auto-fix | --model <name>]"
---

# Manual Audit

Run the audit process manually.

## Execute

```bash
node ${CLAUDE_PLUGIN_ROOT}/audit.mjs {{ arguments }}
```

## After Completion

Read the respond file (gpt.md) and summarize:
- Verdict per item (agree_tag or pending_tag)
- Rejection codes with reasons
- Recommended next steps

## Options

| Flag | Effect |
|------|--------|
| `--dry-run` | Print audit prompt without executing |
| `--no-resume` | Fresh session (don't resume previous) |
| `--auto-fix` | Auto-correct via Claude CLI after audit |
| `--model <name>` | Model override (default: gpt-5.4) |
| `--reset-session` | Delete saved session before running |
| `--watch-file <path>` | Override watch file path (worktree support) |
