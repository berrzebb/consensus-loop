---
name: consensus-loop
description: Guide for writing proper evidence packages for consensus-loop code review. Use when writing or editing the feedback watch file (claude.md), submitting code for audit review, or when [CHANGES_REQUESTED] items need to be addressed.
version: 1.0.0
---

# Consensus Loop — Evidence Package Guide

When submitting code changes for consensus review, write a properly structured evidence package in the watch file (`feedback/claude.md`).

## Required Structure

Every `[REVIEW_NEEDED]` item must include these sections:

```markdown
## Audit Scope

- <description of change> [REVIEW_NEEDED]

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

## Tag Lifecycle

```
[REVIEW_NEEDED] → Codex audits → [APPROVED] or [CHANGES_REQUESTED]
                                    ↓
                            Fix issues, re-submit with [REVIEW_NEEDED]
```

## Addressing [CHANGES_REQUESTED]

When Codex returns `[CHANGES_REQUESTED]`:

1. Read the rejection codes in `gpt.md` (e.g., `needs-evidence`, `test-gap`, `scope-mismatch`)
2. Fix each cited issue
3. Update the evidence package with corrected claims, tests, and results
4. Change the tag back to `[REVIEW_NEEDED]` to trigger a new audit cycle
