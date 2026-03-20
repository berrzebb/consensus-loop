# Verification Checks (CQ/T/CC/CL/S/I/FV/CV)

## Step 2: Code Quality (CQ)

```bash
# CQ-1: Per-file eslint
for file in <changed_files>; do npx eslint "$file"; done

# CQ-2: Type check
npx tsc --noEmit

# CQ-4: No forbidden patterns in new code
node ${CLAUDE_PLUGIN_ROOT}/scripts/audit-scan.mjs type-safety
```

Record: PASS or FAIL with file:line for each failure.

## Step 3: Test (T)

```bash
# T-1: Execute evidence test commands exactly as written
<test_command_from_evidence>

# T-3: Check for regressions in related scope
npx vitest run <related_test_dirs>
```

For T-2 (direct test exists): Grep for test files that import/reference changed modules.

Record: PASS or FAIL with test counts.

## Step 4: Claim-Code Consistency (CC)

Compare `### Changed Files` from evidence against the actual diff scope.
If evidence includes a diff basis (commit range), use `git diff --name-only <base>..<head>`.
Otherwise, fall back to `git diff --name-only` for uncommitted changes.
Flag any file in diff but not in evidence, or vice versa.

## Step 5: Cross-Layer Contract (CL)

For each changed file:
- If BE file → check if evidence documents what FE needs
- If new interface/port → grep for at least one consumer
- If infra change → check if affected consumers are listed

Record: PASS, FAIL, or N/A.

## Step 6: Security (S)

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/audit-scan.mjs hardcoded
```

For new API endpoints: check for auth guard in route handler.

## Step 7: i18n (I)

For changed files containing user-facing strings: check ko.json AND en.json.

## Step 8: Frontend Verification (FV)

Only runs if changed files include frontend paths (e.g., `web/`, `src/dashboard/`).

Check: page loads, elements exist in DOM, no console errors, build succeeds.

## Step 8.5: Coverage Verification (CV)

Requires `npm run test:coverage` to have been run.

```bash
# Per-file coverage via tool-runner
node "${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs" coverage_map --path <changed-file-dir>
```

For each changed **source** file (exclude test files):
- CV-1: `statements.pct` ≥ 85%
- CV-2: `branches.pct` ≥ 75%
- CV-3: File present in coverage-summary.json

Record: PASS or FAIL with file + actual% vs threshold.

## Exceptions

- Files in `node_modules/`, `.git/`, `coverage/` are excluded
- Test files (`*.test.ts`, `*.spec.ts`) are exempt from CQ-4
- FV checks are skipped if no frontend files in Changed Files
- CL checks are N/A for pure refactoring (no new interfaces)
