---
name: consensus-audit
description: Run a consensus-loop audit manually — Codex reviews pending [REVIEW_NEEDED] items in the watch file
arguments:
  - name: options
    description: "Optional flags: --dry-run, --no-resume, --auto-fix, --model <name>"
    required: false
---

Run the consensus-loop audit process manually.

## Steps

1. Execute the audit script:

```bash
node ${CLAUDE_PLUGIN_ROOT}/audit.mjs {{ options }}
```

2. After the audit completes, read the respond file (gpt.md) and summarize the results to the user:
   - Show the verdict for each item ([APPROVED] or [CHANGES_REQUESTED])
   - List any rejection codes with their specific reasons
   - Show the recommended next steps

## Common Options

- `--dry-run` — Print the generated audit prompt without executing Codex
- `--no-resume` — Start a fresh audit session instead of resuming
- `--auto-fix` — Automatically run corrections via Claude CLI after audit
- `--model <name>` — Use a specific model (default: gpt-5.4)
- `--reset-session` — Delete the saved session before running
