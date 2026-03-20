---
name: cl-verify
description: "Shortcut for /consensus-loop:verify — run done-criteria checks (CQ/T/CC/CL/S/I/FV/CV)"
arguments:
  - name: category
    description: "Optional: specific category (CQ, T, CC, CL, S, I, FV, CV)"
    required: false
---

Invoke the verify skill: `/consensus-loop:verify {{ category }}`
