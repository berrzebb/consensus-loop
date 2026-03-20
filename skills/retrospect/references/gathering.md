# Phase 1: Gather Sources

Collect from **three** sources, in order of richness:

## 1a. Conversation (richest source)

Scan the current conversation for learning signals. These are things the user said or did that reveal preferences, corrections, or decisions:

| Signal Pattern | Memory Type | Example |
|---------------|-------------|---------|
| User correction ("아뇨", "that's wrong", "don't do X") | feedback | "아뇨 설정 문제입니다" → settings issue, not a bug |
| User preference confirmed ("yes exactly", "perfect") | feedback | User accepted single bundled PR approach |
| Architecture decision made | project | Chose Three.js over Unity for 3D engine |
| User role/expertise revealed | user | "I've been writing Go for 10 years but this is my first React project" |
| External resource referenced | reference | External API docs or tool documentation shared |

Focus on **non-obvious** signals. "Fix the bug" is not a learning. "Don't mock the database — we got burned last quarter" IS a learning.

## 1b. Audit History (structured patterns)

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs" audit_history --summary
```

Parse the output for:

```
rejection_code_counts:
  test-gap: 5      ← 3+ = pattern worth recording
  CC-2: 3          ← 3+ = pattern worth recording
  lint-gap: 1      ← below threshold, skip

false_positive_rates:
  CC-2: 0.40       ← >0.30 = policy issue worth recording

tracks:
  OR: { rounds: 8, approved: 5, rejected: 3 }
  FE: { rounds: 2, approved: 2, rejected: 0 }  ← clean track, no learnings
```

**Threshold rules:**
- Rejection code appears **3+ times** → feedback candidate
- False positive rate **> 30%** → feedback candidate (policy review)
- Track has **5+ correction rounds** → project candidate (process issue)
- Track approved **first try** → feedback candidate (validated approach)

## 1c. Recent Git History

```bash
git log --oneline -20
```

Look for:
- `fix:` → `fix:` → `fix:` sequences (repeated corrections = learning opportunity)
- Large commits after many small fixes (integration pain point)

## Quick Mode Shortcut

In Quick mode, skip 1b (audit_history). Use only conversation + git log. This is sufficient for casual "what did we learn?" queries.
