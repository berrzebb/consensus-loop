---
name: cl-tools
description: "Shortcut for /consensus-loop:tools — run deterministic analysis tools"
arguments:
  - name: tool_and_args
    description: "Tool name + args (e.g., 'code_map --path src/')"
    required: false
---

Invoke the tools skill: `/consensus-loop:tools {{ tool_and_args }}`
