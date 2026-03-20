---
name: cl-orch
description: "Shortcut for /consensus-loop:orchestrator — distribute tasks, manage agents"
arguments:
  - name: task_id
    description: "Optional task ID to assign"
    required: false
---

Invoke the orchestrator skill: `/consensus-loop:orchestrator {{ task_id }}`
