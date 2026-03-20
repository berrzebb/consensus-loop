---
name: cl-merge
description: "Shortcut for /consensus-loop:merge — squash-merge worktree branch"
arguments:
  - name: target_branch
    description: "Target branch (default: main)"
    required: false
---

Invoke the merge skill: `/consensus-loop:merge {{ target_branch }}`
