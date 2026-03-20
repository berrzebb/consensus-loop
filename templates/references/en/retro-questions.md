# Retrospective Questions

> Questions used in retrospective after audit cycle completion. Add/modify to fit your team.

## ① What went well

- What design/implementation worked effectively?
- What was effective in auditor-implementer collaboration?
- Are there reusable patterns or principles?

## ② What was problematic

- What required repeated corrections?
- What was inefficient or unclear?
- What was the root cause of rejections/pending items?

## ③ Memory cleanup

- Detailed criteria → `references/{{LOCALE}}/memory-cleanup.md`
- Identify duplicate/stale memory files → clean up
- Memory derivable from code → delete
- Newly learned principles → record in memory

## ④ Bidirectional feedback

- AI → User: Honest feedback on collaboration style
- User → AI: Areas for improvement

## ⑤ Act — Register improvement items (PDCA)

Run `act_analyze` tool (or `node tool-runner.mjs act_analyze`) to produce structured improvement items from audit history + FVM results.

1. Review the metrics and improvement items with the user
2. User approves, modifies, or rejects each item
3. Append approved items to `work-catalog.md` under `## Act Improvements`
4. These items become inputs for the next Plan cycle

Format for work-catalog entry:
```markdown
| ID | Work item | Type | Source | Priority |
|---|---|---|---|---|
| ACT-A-1 | Review CC-2 rejection policy (40% FP rate) | policy | audit_history | high |
| ACT-F-1 | Fix FVM page-to-endpoint tier mapping | tooling | fvm_validate | medium |
```

## Caution

- **Do not modify code directly** — suggest improvements only
- **Do not proceed without user confirmation** — wait for feedback at each step
