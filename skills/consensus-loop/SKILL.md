---
name: consensus-loop:guide
description: Guide for writing proper evidence packages for consensus-loop code review. Use when writing or editing the feedback watch file, submitting code for audit review, or when pending_tag items need to be addressed.
version: 1.0.0
---

# Consensus Loop — Evidence Package Guide

When submitting code changes for consensus review, write a properly structured evidence package in the watch file (path configured in `config.json` → `consensus.watch_file`).

> **Important:** Tag names below (`trigger_tag`, `agree_tag`, `pending_tag`) are placeholders. Check your project's `${CLAUDE_PLUGIN_ROOT}/config.json` for actual values.

## Required Structure

Every `trigger_tag` item must include these sections:

```markdown
## [trigger_tag] Task Title

### Claim
What was changed and why — be specific about the function/module modified.

### Changed Files
- `path/to/file1.ts`
- `path/to/file2.ts`

### Test Command
<exact command that can be run to verify — no glob patterns>

### Test Result
<paste actual terminal output from running the test command>

### Residual Risk
- <known limitations or risks, or "none">
```

## Rules

1. **Test Command** must be executable as-is — no glob patterns (`*.test.ts`), use explicit file paths
2. **Test Result** must be actual terminal output, not summaries like "all tests passed"
3. **Claim** must match the actual code changes — don't claim `extractText` was modified if the change is in `convertTableToMarkdown`
4. **Changed Files** paths must use backtick formatting: `` `path/to/file.ts` ``
5. **Every changed file must pass eslint individually** — the auditor runs `npx eslint <file>` per file

## Tag Lifecycle

```
[trigger_tag] → Codex audits → [agree_tag] or [pending_tag]
                                    ↓
                            Fix issues, re-submit with [trigger_tag]
```

## Addressing `pending_tag` Rejections

When Codex returns `pending_tag`:

1. Read the rejection codes in the respond file (e.g., `test-gap`, `claim-drift`, `scope-mismatch`)
2. Fix each cited issue at the specific file:line locations
3. Update the evidence package with corrected claims, tests, and results
4. Keep the `trigger_tag` to trigger a new audit cycle
