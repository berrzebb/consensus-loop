# PRD (Product Requirements Document) Guide

## Purpose

The PRD is the **master design document** for the entire project. It spans all tracks and is the single source of truth for WHAT to build and WHY.

## Location

`{planning_dir}/PRD.md` — one file per project, never per-track.

## Structure

```markdown
# Product Requirements Document: <Product Name>

## 1. Problem & Background
What problem exists today. Why it matters now. What happens if unsolved.
- User pain points (with evidence — support tickets, metrics, user interviews)
- Competitive gaps or market pressure
- Internal technical debt driving the need

## 2. Goals & Success Metrics

| Goal | Metric | Target | Measurement Method |
|------|--------|--------|--------------------|
| Reduce review time | Avg review duration | < 5 min | Audit history logs |

Goals must be measurable. "Improve UX" is not a goal. "Reduce task completion time by 30%" is.

## 3. User Scenarios
Concrete usage flows, not abstract personas.

> **Scenario: Developer submits a PR**
> 1. Developer writes code in a worktree
> 2. Implementer agent runs tests and submits evidence
> 3. Auditor verifies and approves
> 4. Orchestrator merges the worktree
> **Expected outcome**: Full cycle completes in < 30 min

Each scenario has a trigger, steps, and expected outcome.

## 4. Tracks & Requirements

### Track Map

| Track | Name | Status | Owner | Requirements |
|-------|------|--------|-------|-------------|
| OR | Orchestration | in-progress | — | FR-1~FR-5, NFR-1 |

### Functional Requirements

| ID | Track | Requirement | Acceptance Criteria | Priority | Depends On |
|----|-------|-------------|-------------------|----------|------------|
| FR-1 | OR | Description | Verifiable condition | P0 | — |

### Non-Functional Requirements

| ID | Track | Category | Requirement | Metric |
|----|-------|----------|-------------|--------|
| NFR-1 | OR | Performance | Description | Threshold |

## 5. Technical Considerations
- System constraints and infrastructure dependencies
- Known risks with mitigation strategies
- Open questions requiring team decision (link to ADR when resolved)

## 6. Release Scope

| Version | Included | Excluded | Target Date |
|---------|----------|----------|-------------|
| v1.0 | FR-1~FR-5 | FR-6~FR-10 | — |
```

## Writing Principles

1. **Problem before solution** — Section 1-3 define the problem space. Do not jump to requirements without establishing context.
2. **Verifiable acceptance criteria** — Every FR must have a condition that can be checked by a test or inspection. "Works correctly" fails this test.
3. **Global IDs** — FR-1 is used once in the entire PRD. IDs are monotonically increasing and never reused, even if a requirement is removed.
4. **Track assignment** — Every FR/NFR belongs to exactly one track. If a requirement spans tracks, split it.
5. **Living document** — New features append to existing tables. Status changes update the Track Map. Never rewrite the entire document for a single addition.

## When to Update

- New feature request → Add FRs/NFRs, update Track Map and Release Scope
- Scope change → Move FRs between Release versions
- Track completion → Update Track Map status
- Requirement removed → Mark as `deprecated` (do not delete — preserve history)
