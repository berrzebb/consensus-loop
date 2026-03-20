# Work Catalog Guide

## Purpose

The work catalog is the **flat index of all work breakdown items** across all tracks. It enables cross-track search, filtering, and progress tracking without reading each track's individual WB document.

## Location

`{planning_dir}/work-catalog.md` — one file per project.

## Structure

```markdown
# Work Catalog

## Summary

| Track | Total | Done | In Progress | Blocked | Remaining |
|-------|-------|------|-------------|---------|-----------|
| OR | 5 | 3 | 1 | 0 | 1 |
| FE | 4 | 0 | 0 | 2 | 2 |
| Total | 9 | 3 | 1 | 2 | 3 |

## All Items

| ID | Track | Title | PRD | Type | Risk | Status | Agent |
|----|-------|-------|-----|------|------|--------|-------|
| OR-1 | OR | Core consensus loop | FR-1 | foundation | low | done | — |
| OR-2 | OR | Response auto-sync | FR-2 | local refactor | low | done | — |
| OR-3 | OR | Quality rules | FR-3 | cross-cutting | medium | in-progress | implementer-a |
| FE-1 | FE | Dashboard layout | FR-6 | foundation | low | blocked | — |
| FE-2 | FE | Workflow editor | FR-7 | cross-cutting | high | blocked | — |

## Filters

### By Risk: High

| ID | Track | Title | Status |
|----|-------|-------|--------|
| FE-2 | FE | Workflow editor | blocked |

### By Status: Blocked

| ID | Track | Blocker |
|----|-------|---------|
| FE-1 | FE | Waiting for OR API contract |
| FE-2 | FE | Waiting for OR API contract |
```

## Writing Principles

1. **Single source of WB IDs** — If a WB item exists in a track's work-breakdown.md, it MUST appear here. Orphan WBs in either direction are bugs.
2. **PRD traceability** — Every WB item links to a PRD FR/NFR. If it doesn't trace to a requirement, it shouldn't exist.
3. **Status is current** — Update when WBs change status. The orchestrator reads this to decide what to assign next.
4. **Agent tracking** — When an implementer agent is assigned, record the agent ID. This prevents duplicate assignment.
5. **Summary is computed** — The summary table counts must match the detail rows. Rebuild after changes.

## Types

| Type | Description |
|------|-------------|
| `foundation` | Core infrastructure, other WBs depend on this |
| `local refactor` | Changes within a single module, no cross-track impact |
| `cross-cutting` | Touches multiple modules or tracks |
| `migration` | Data or schema migration |
| `testing` | Test-only work (no production code changes) |
| `policy` | Configuration or policy file changes |
