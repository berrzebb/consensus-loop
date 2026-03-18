---
name: consensus-loop:verify
description: "Run all done-criteria checks (CQ/T/CC/CL/S/I/FV) and produce a pass/fail verification report. Use after implementing code, before submitting evidence to the consensus-loop audit."
argument-hint: "[optional: specific category - CQ, T, CC, CL, S, I, FV]"
model: claude-sonnet-4-6
allowed-tools: Read, Grep, Glob, Bash(npx *), Bash(node *), Bash(git diff *), Bash(git status *), Bash(cat *), Bash(ls *)
---

# Implementation Verification

Runs all done-criteria checks before evidence submission. Criteria loaded from `${CLAUDE_PLUGIN_ROOT}/templates/references/${locale}/done-criteria.md`. Passing all checks means the evidence is ready for audit.

## Quick Reference

| # | Category | Key Checks | Tool |
|---|----------|-----------|------|
| 1 | Code Quality (CQ) | `npx eslint <file>`, `npx tsc --noEmit`, audit-scan type-safety | Bash |
| 2 | Test (T) | Execute evidence test commands, check direct tests exist | Bash |
| 3 | Claim-Code (CC) | `git diff --name-only` vs Changed Files | Bash, Grep |
| 4 | Cross-Layer (CL) | BE→FE contracts, consumer existence | Read, Grep |
| 5 | Security (S) | Input validation, auth guards, audit-scan hardcoded | Grep, Read |
| 6 | i18n (I) | Locale keys in ALL locale files | Grep |
| 7 | Frontend (FV) | Page loads, DOM elements, console errors, build | Browser (if FE files changed) |

## Workflow

### Step 1: Gather Context

1. Read `${CLAUDE_PLUGIN_ROOT}/config.json` → extract `consensus.trigger_tag`, `consensus.watch_file`
2. Read the watch file — find the section containing `trigger_tag`
3. Parse: Claim, Changed Files, Test Command, Test Result, Residual Risk
4. Extract the list of changed files from `### Changed Files`

If no trigger_tag section found → report "No evidence to verify" and stop.

### Step 2: Code Quality (CQ)

```bash
# CQ-1: Per-file eslint
for file in <changed_files>; do npx eslint "$file"; done

# CQ-2: Type check
npx tsc --noEmit

# CQ-4: No forbidden patterns in new code
node ${CLAUDE_PLUGIN_ROOT}/scripts/audit-scan.mjs type-safety
```

Record: PASS or FAIL with file:line for each failure.

### Step 3: Test (T)

```bash
# T-1: Execute evidence test commands exactly as written
<test_command_from_evidence>

# T-3: Check for regressions in related scope
npx vitest run <related_test_dirs>
```

For T-2 (direct test exists): Grep for test files that import/reference changed modules.

Record: PASS or FAIL with test counts.

### Step 4: Claim-Code Consistency (CC)

Compare `### Changed Files` from evidence against `git diff --name-only`.
Flag any file in diff but not in evidence, or vice versa.

### Step 5: Cross-Layer Contract (CL)

For each changed file:
- If BE file → check if evidence documents what FE needs
- If new interface/port → grep for at least one consumer
- If infra change → check if affected consumers are listed

Record: PASS, FAIL, or N/A.

### Step 6: Security (S)

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/audit-scan.mjs hardcoded
```

For new API endpoints: check for auth guard in route handler.

### Step 7: i18n (I)

For changed files containing user-facing strings: check ko.json AND en.json.

### Step 8: Frontend Verification (FV)

Only runs if changed files include frontend paths (e.g., `web/`, `src/dashboard/`).

Check: page loads, elements exist in DOM, no console errors, build succeeds.

### Step 9: Integrated Report

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

**Total: X/7 passed, Y issues found**
```

If all pass → "Ready for evidence submission."
If any fail → list issues with fix recommendations.

## Exceptions

- Files in `node_modules/`, `.git/`, `coverage/` are excluded
- Test files (`*.test.ts`, `*.spec.ts`) are exempt from CQ-4
- FV checks are skipped if no frontend files in Changed Files
- CL checks are N/A for pure refactoring (no new interfaces)
