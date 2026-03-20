---
name: cl-audit
description: "Shortcut for /consensus-loop:audit"
arguments:
  - name: options
    description: "Flags: --dry-run, --no-resume, --auto-fix, --model <name>"
    required: false
---

Invoke the audit skill: `/consensus-loop:audit {{ options }}`
