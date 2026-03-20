# Phase 4-6: Present, Execute, Verify

## Phase 4: Present to User

Present candidates grouped by action, with source evidence:

```markdown
## Memory Candidates

### ✏️ Create (3)

| # | Type | Summary | Source Evidence |
|---|------|---------|----------------|
| 1 | feedback | Description of learning | audit_history: code 5x |
| 2 | project | Description of context | session: ADR decision |
| 3 | user | Description of preference | conversation: user said X |

### 🔄 Update (1)

| # | File | Change | Reason |
|---|------|--------|--------|
| 4 | project_session_handoff.md | Add new results | Session completed |

### 🗑️ Delete (1)

| # | File | Reason |
|---|------|--------|
| 5 | feedback_old.md | Already codified in SKILL.md |

### ⏭️ Skipped (2)

| # | Topic | Reason Skipped |
|---|-------|---------------|
| 6 | lint-gap 1x | Below 3x threshold |
| 7 | Clean track pass | No learnings to extract |
```

**Skipped items are shown** so the user can override ("actually, record that one").

### Interactive Mode

Wait for user approval. Accept responses like:
- "1, 2, 4 승인" → create #1, #2, update #4
- "전부 승인" → execute all
- "3번은 빼고" → skip #3
- "5번은 삭제하지 마세요" → keep #5

### Headless Mode

Auto-approve candidates that meet threshold rules. Defer ambiguous ones:
- Threshold-met candidates → auto-approve
- Ambiguous candidates → mark `⏭️ deferred to orchestrator`
- **Never ask questions** — output the report and exit

## Phase 5: Execute

For each approved item:

1. **Create**: Write file with frontmatter + body + Why/How to apply → add to MEMORY.md
2. **Update**: Read existing → apply changes → update frontmatter description if needed
3. **Delete**: Remove file → remove from MEMORY.md index

### Verify Integrity (Full mode only)

After all writes:

1. Every MEMORY.md entry → file exists on disk (`Glob` check)
2. Every memory file → has entry in MEMORY.md
3. MEMORY.md line count < 200
4. No duplicate topics across memory files

Quick mode skips integrity verification.

## Phase 6: Summary

```markdown
## Retrospect Complete

| Action | Count | Details |
|--------|-------|---------|
| Created | 2 | feedback × 1, project × 1 |
| Updated | 1 | project_session_handoff.md |
| Deleted | 1 | feedback_old.md |
| Skipped | 2 | below threshold |
| **MEMORY.md** | **12 entries** | **38 lines** (limit: 200) |
```

In headless mode, also include:
```markdown
### Deferred to Orchestrator
| # | Topic | Reason |
|---|-------|--------|
| 3 | Ambiguous pattern | Could be project or feedback — needs human judgment |
```
