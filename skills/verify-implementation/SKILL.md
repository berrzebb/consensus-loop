---
name: quorum:verify
description: "Run all done-criteria checks (CQ/T/CC/CL/S/I/FV/CV) and produce a pass/fail verification report. Use after implementing code, before submitting evidence to the quorum audit."
argument-hint: "[optional: specific category - CQ, T, CC, CL, S, I, FV, CV]"
model: claude-sonnet-4-6
allowed-tools: Read, Grep, Glob, Bash(npx *), Bash(node *), Bash(python *), Bash(cargo *), Bash(go *), Bash(ruff *), Bash(git diff *), Bash(git status *), Bash(cat *), Bash(ls *)
---

# Implementation Verification

Run all done-criteria checks before evidence submission. Criteria from `${CLAUDE_PLUGIN_ROOT}/core/templates/references/${locale}/done-criteria.md`.

## Execution Context

| Context | Behavior |
|---------|----------|
| **Interactive** | Run checks → present report → suggest fixes |
| **Headless** | Run checks → output report → exit with status code (0 = all pass, 1 = failures) |

In headless mode, do NOT ask "should I fix this?" — output the report and exit. The caller (implementer agent) reads the report and decides.

## Quick Reference

| # | Category | Key Checks | Tool |
|---|----------|-----------|------|
| 1 | Code Quality (CQ) | Per-file + project-wide checks from `quality_rules.presets`, audit-scan type-safety | Bash |
| 2 | Test (T) | Execute evidence test commands, check direct tests exist | Bash |
| 3 | Claim-Code (CC) | Diff scope vs Changed Files | Bash, Grep |
| 4 | Cross-Layer (CL) | BE→FE contracts, consumer existence | Read, Grep |
| 5 | Security (S) | Input validation, auth guards, audit-scan hardcoded | Grep, Read |
| 6 | i18n (I) | Locale keys in ALL locale files | Grep |
| 7 | Frontend (FV) | Page loads, DOM elements, console errors, build | Browser (if FE) |
| 8 | Coverage (CV) | stmt ≥ 85%, branch ≥ 75% per changed file | tool-runner.mjs |

## Workflow

### Step 1: Gather Context

1. Read config → extract `consensus.trigger_tag`, `consensus.watch_file`
2. Read watch file → find section with `trigger_tag`
3. Parse: Claim, Changed Files, Test Command, Test Result, Residual Risk
4. Extract changed file list

No trigger_tag section → "No evidence to verify" → stop.

### Steps 2-8: Run Checks

Read `references/checks.md` for detailed commands and criteria per category.

### Step 9: Verification Report

```markdown
## Verification Report

| # | Category | Status | Details |
|---|----------|--------|---------|
| 1 | Code Quality (CQ) | PASS / X issues | ... |
| 2 | Test (T) | PASS / X issues | ... |
| 3 | Claim-Code (CC) | PASS / X issues | ... |
| 4 | Cross-Layer (CL) | PASS / N/A | ... |
| 5 | Security (S) | PASS / X issues | ... |
| 6 | i18n (I) | PASS / X issues | ... |
| 7 | Frontend (FV) | PASS / SKIP | ... |
| 8 | Coverage (CV) | PASS / X issues | ... |

**Total: X/8 passed, Y issues found**
```

If all pass → "Ready for evidence submission."
If any fail → list issues with fix recommendations.

## Completeness Rule

**Every category row (1-8) must have a status:**

| Status | When |
|--------|------|
| PASS | Check ran and passed |
| FAIL (N issues) | Check ran and found problems |
| SKIP | Not applicable — **must include reason** |
| N/A | Cannot be evaluated — **must include reason** |

A report with any blank status cell is incomplete. Fill all 8 rows before outputting.
