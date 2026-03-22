# Track README Guide

## Purpose

The track README is the **design overview** for a single track. It answers: "What does this track do, why, and how do we know it's done?"

## Location

`{planning_dir}/{track-name}/README.md` — one per track.

## Structure

```markdown
# {Track Name}

> Status: `planned` | `in-progress` | `verified`
> Track: {ID}
> PRD: FR-1~FR-5, NFR-1

## Problem
What specific problem this track solves. Not "what to build" but "what's broken or missing."
Reference the PRD's Problem section for project-wide context, then narrow to this track's scope.

## Goal
What "done" looks like for this track. One clear sentence.

## Baseline
Current state of the codebase relevant to this track:
- What already exists (files, modules, tests)
- What works and what doesn't
- Quantitative baseline where possible (e.g., "current coverage: 42%")

Data source: `code_map` and `dependency_graph` results at planning time.

## Scope

### In Scope
- Specific items this track will deliver
- Each item maps to one or more WB items

### Out of Scope
- Items explicitly NOT in this track
- Adjacent tracks that handle related concerns

## Dependencies
- **Upstream**: What must be done before this track can start
- **Downstream**: What this track unblocks

## Exit Condition
Verifiable conditions that ALL must be true for this track to be `verified`:
- [ ] All WB items pass RTM verification
- [ ] Project-wide checks from `quality_rules.presets` pass
- [ ] Coverage ≥ 85% on all changed files
- [ ] API contract consumers confirmed working

## Design Documents
- [work-breakdown.md](./work-breakdown.md) — Implementation plan
- [api-contract.md](./api-contract.md) — Interface specification (if applicable)
- [test-strategy.md](./test-strategy.md) — Testing approach (if applicable)
```

## Writing Principles

1. **Problem-first** — Start with why, not what. The reader should understand the motivation before seeing the solution.
2. **Baseline is factual** — Use tool output (`code_map`, `dependency_graph`) to describe the current state. Don't guess.
3. **Exit conditions are checkable** — Every condition must be verifiable by running a command or reading a file. "Improved" is not an exit condition.
4. **Scope is bilateral** — Both "in scope" and "out of scope" are explicit. Ambiguity in scope causes the most planning failures.
5. **Link to work** — The README describes WHAT and WHY. The work-breakdown describes HOW. Don't duplicate content.
