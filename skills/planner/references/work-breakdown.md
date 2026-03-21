# Work Breakdown Guide

## Purpose

The work breakdown decomposes a track into **implementable work packages**. Each WB item is small enough for a single implementer agent session and traceable back to a PRD requirement.

## Location

`{planning_dir}/{track-name}/work-breakdown.md` — one per track.

## Structure

```markdown
# Work Breakdown: {Track Name}

## Working Principles
- Project-wide principles inherited from CLAUDE.md
- Track-specific principles (e.g., "all new endpoints require FVM row")

## Recommended Sequence
1. `{TRACK}-1` First work package
2. `{TRACK}-2` Second work package (requires {TRACK}-1)
3. `{TRACK}-3` Third work package (parallel with {TRACK}-2)

## {TRACK}-1 {Title}

- **Goal**: What this package achieves (1 sentence)
- **PRD**: FR-1 (links to the requirement this implements)
- **Prerequisite**: WB IDs or track names that must complete first
- **First touch files**:
  - `src/path/to/file.ts` — description of change
  - `src/path/to/other.ts` — description of change
- **Implementation**:
  - Specific item 1
  - Specific item 2
- **BE requirements**: (if FE task) What the BE must provide
  - Endpoint: `POST /api/v1/resource`
  - Response shape: `{ data: { id, name } }`
- **FE requirements**: (if BE task) What the FE will consume
  - Component: `ResourceList` reads `GET /api/v1/resources`
- **Tests**:
  - Unit: `tests/path/file.test.ts` — what to test
  - Integration: `tests/path/integration.test.ts` — what to verify
- **Integration owner**: (for convergence points only) `true` — this WB is responsible for wiring all upstream producers into the runtime path. The implementer must verify that every dependency's public API is actually called, not just imported.
- **Done**:
  - Verifiable exit condition (derived from FR acceptance criteria)
  - If `integration_owner: true`: must also pass integration invariants (Runtime Entry Closure, Consumer Exists, Persistence Applied)
  - Example: "`<test runner> tests/path/file.test.*` passes with 3+ test cases"
```

## Writing Principles

1. **One WB = one implementer session** — If a WB item would take more than ~60 minutes for an implementer agent, split it. Too large → agent loses context. Too small → overhead from evidence/audit cycle.
2. **PRD traceability** — Every WB item must reference at least one FR or NFR. If you can't trace it, it's either scope creep or a missing requirement in the PRD.
3. **First touch files are specific** — List exact file paths, not directories. The implementer should know exactly where to start.
4. **Cross-layer contracts are pairs** — If a WB changes a BE endpoint, the "FE requirements" field documents what the FE consumer expects. This is what the CL done-criteria check verifies.
5. **Done is derived from FR acceptance** — The WB's "Done" field should be a refinement of the FR's acceptance criteria, made concrete with file paths and test commands.
6. **Sequence is a DAG, not a list** — Some WBs can run in parallel. Mark parallel items at the same sequence number or note "(parallel with {TRACK}-N)".

## Sizing Guidelines

| Size | Files Changed | Tests Added | Typical Duration | Verdict |
|------|--------------|-------------|------------------|---------|
| XS | 1-2 | 1-2 | < 15 min | OK, but consider merging with adjacent WB |
| S | 2-4 | 2-4 | 15-30 min | Ideal |
| M | 4-8 | 3-6 | 30-60 min | Acceptable |
| L | 8-15 | 5-10 | 60-90 min | Split if possible |
| XL | 15+ | 10+ | > 90 min | Must split |

## Anti-Patterns

- **"Update everything"** — A WB that says "update all files to use new pattern" is not implementable. List specific files.
- **No tests specified** — If a WB has implementation but no tests, the T done-criteria will reject it. Design tests at planning time.
- **Circular dependencies** — WB-2 requires WB-3 which requires WB-2. Use `dependency_graph` to detect.
- **Hidden scope** — "Implementation: refactor as needed" hides unknown work. Be specific.
