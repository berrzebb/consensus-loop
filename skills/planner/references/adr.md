# ADR (Architecture Decision Record) Guide

## Purpose

ADRs capture **why** a significant technical decision was made. Without ADRs, agents and future developers may unknowingly contradict or redo past decisions.

## Location

`{planning_dir}/adr/ADR-{NNN}-{slug}.md` — one file per decision.

Index file: `{planning_dir}/adr/README.md` — links to all ADRs with status.

## When to Write an ADR

- Choosing between two or more viable approaches (technology, pattern, architecture)
- Changing an existing architectural pattern
- Deciding NOT to do something (rejection is also a decision)
- Any decision that affects 3+ files or 2+ tracks

Do NOT write ADRs for obvious choices (e.g., "use TypeScript in a TypeScript project").

## Structure

```markdown
# ADR-{NNN}: {Decision Title}

**Status**: `proposed` | `accepted` | `deprecated` | `superseded by ADR-XXX`
**Date**: YYYY-MM-DD
**Tracks**: OR, FE (which tracks are affected)
**PRD**: FR-7, NFR-3 (which requirements drove this decision)

## Context
What is the problem or situation that requires a decision?
Include relevant constraints, forces, and background.

## Options Considered

### Option A: {Name}
- Pros: ...
- Cons: ...
- Effort: Low/Medium/High

### Option B: {Name}
- Pros: ...
- Cons: ...
- Effort: Low/Medium/High

## Decision
Which option was chosen and WHY.
The rationale is the most important part — not the decision itself.

## Consequences
What changes as a result of this decision:
- What becomes easier
- What becomes harder
- What new constraints are introduced
- What follow-up work is needed
```

## Writing Principles

1. **Context over conclusion** — A future reader (or agent) should understand the full reasoning, not just the answer. "We chose Redis" is useless without "because we need pub/sub with < 10ms latency and Redis Streams provides exactly-once delivery."
2. **Record rejections** — Why Option B was NOT chosen is as valuable as why Option A was chosen. It prevents future agents from re-proposing rejected approaches.
3. **Link to PRD** — Every ADR should reference the FR/NFR that motivated the decision.
4. **Immutable once accepted** — Don't edit an accepted ADR. If the decision changes, write a new ADR that supersedes the old one. This preserves the history of why things changed.
5. **Short is better** — An ADR that takes 20 minutes to read won't be read. Target 1-2 pages.

## Index Format

```markdown
# Architecture Decision Records

| # | Title | Status | Date | Tracks |
|---|-------|--------|------|--------|
| 1 | Use Redis for event bus | accepted | 2026-03-15 | OR, SO |
| 2 | SolidJS over React for dashboard | accepted | 2026-03-10 | FE |
| 3 | Reject GraphQL in favor of REST | accepted | 2026-03-12 | OR, FE |
```
