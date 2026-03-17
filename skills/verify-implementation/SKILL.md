---
name: verify-implementation
description: Run all done-criteria checks before evidence submission. Executes verify-* skills sequentially and produces an integrated report. Use after implementing code, before submitting evidence to the consensus loop.
argument-hint: "[optional: specific category - CQ, T, CC, CL, S, I, FV]"
model: claude-sonnet-4-6
allowed-tools: Read, Grep, Glob, Bash(npx *), Bash(node *), Bash(git diff *), Bash(git status *), Bash(cat *), Bash(ls *)
---

# Implementation Verification

## Purpose

Runs all done-criteria checks before evidence submission. Criteria loaded from `${CLAUDE_SKILL_DIR}/../../templates/references/${locale}/done-criteria.md`. Each category maps to a verify step. Passing all checks means the evidence is ready for audit.

## Execution Targets

| # | Category | Criteria IDs | Tool |
|---|----------|-------------|------|
| 1 | Code Quality | CQ-1~CQ-4 | Bash (eslint, tsc) |
| 2 | Test | T-1~T-4 | Bash (vitest) |
| 3 | Claim-Code Consistency | CC-1~CC-3 | Grep, Bash (git diff) |
| 4 | Cross-Layer Contract | CL-1~CL-3 | Read, Grep |
| 5 | Security | S-1~S-3 | Grep, Read |
| 6 | i18n | I-1~I-2 | Grep |
| 7 | Frontend Verification | FV-1~FV-5 | agent-browser (if FE files changed) |

## Workflow

### Step 1: Gather Context

1. Read `${CLAUDE_SKILL_DIR}/../../config.json` → extract `consensus.trigger_tag`, `consensus.watch_file`
2. Read the watch file (path from config) — find the section containing `trigger_tag`
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
node ${CLAUDE_SKILL_DIR}/scripts/audit-scan.mjs type-safety
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

```bash
# CC-2: Changed Files vs git diff
git diff --name-only
```

Compare the listed Changed Files against actual git diff output.
Flag any file in diff but not in evidence, or vice versa.

Record: PASS or FAIL with mismatched files.

### Step 5: Cross-Layer Contract (CL)

For each changed file:
- If BE file → check if evidence documents what FE needs
- If new interface/port → grep for at least one consumer
- If infra change → check if affected consumers are listed

Record: PASS, FAIL, or N/A.

### Step 6: Security (S)

```bash
# S-1: New input paths have validation
# S-3: Sensitive data not in logs/responses
node ${CLAUDE_SKILL_DIR}/scripts/audit-scan.mjs hardcoded
```

For new API endpoints: check for auth guard in route handler.

Record: PASS or FAIL with file:line.

### Step 7: i18n (I)

```bash
# I-1 + I-2: Check for hardcoded user-facing strings
# Verify locale keys exist in ALL locale files
```

For changed files containing user-facing strings: check ko.json AND en.json.

Record: PASS or FAIL.

### Step 8: Frontend Verification (FV)

Only runs if changed files include `web/` paths.

```bash
# FV-1: Page loads
agent-browser navigate <page_url>
agent-browser snapshot

# FV-2: Elements exist in DOM
agent-browser snapshot -s "<selector>"

# FV-4: No console errors
agent-browser eval "window.__console_errors?.length || 0"

# FV-5: Build succeeds
npx vite build
```

Record: PASS or FAIL with DOM state.

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

### Step 10: User Action

If issues found, ask:
1. **Fix all** — auto-apply recommended fixes
2. **Fix individually** — review each fix
3. **Skip** — submit evidence as-is (audit will likely reject)

After fixes → re-run only failed categories → Before/After comparison.

## Exceptions

- Files in `node_modules/`, `.git/`, `coverage/` are excluded
- Test files (`*.test.ts`, `*.spec.ts`) are exempt from CQ-4
- FV checks are skipped if no `web/` files in Changed Files
- CL checks are N/A for pure refactoring (no new interfaces)
