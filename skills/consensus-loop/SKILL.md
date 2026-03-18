---
name: consensus-loop:guide
description: "Guide for writing evidence packages for the consensus-loop watch file. Use when preparing code review submissions, structuring feedback evidence, or addressing audit rejections."
version: 1.0.0
---

# Consensus Loop — Evidence Package Guide

When submitting code changes for consensus review, write a properly structured evidence package in the watch file.

## Step 0: Read Config

Read `${CLAUDE_PLUGIN_ROOT}/config.json` first:
- `consensus.watch_file` → submission path
- `consensus.trigger_tag` / `agree_tag` / `pending_tag` → actual tag values
- `plugin.respond_file` → auditor verdict file
- `plugin.locale` → locale

## Step 1: Write Evidence

Follow the format defined in `${CLAUDE_PLUGIN_ROOT}/templates/references/${locale}/evidence-format.md`.

Required sections: **Claim**, **Changed Files**, **Test Command**, **Test Result**, **Residual Risk**.

Key rules:
- **Test Command** must be executable as-is — no glob patterns, use explicit file paths
- **Test Result** must be actual terminal output, not summaries
- **Claim** must match the actual code changes
- **Changed Files** paths must use backtick formatting
- Every changed file must pass eslint individually
- Use a single **Write** to the watch file (not sequential Edits)

## Step 2: Tag Lifecycle

```
[trigger_tag] → auditor reviews → [agree_tag] or [pending_tag]
                                        ↓
                                Fix issues, re-submit with [trigger_tag]
```

## Step 3: Addressing Rejections

When auditor returns `[pending_tag]`:

1. Read the rejection codes in the respond file (e.g., `test-gap`, `claim-drift`, `scope-mismatch`)
2. Fix each cited issue at the specific file:line locations
3. Update the evidence package with corrected claims, tests, and results
4. Keep the `[trigger_tag]` to trigger a new audit cycle

Full rejection code reference: `${CLAUDE_PLUGIN_ROOT}/templates/references/${locale}/rejection-codes.md`
