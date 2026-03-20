# Test Strategy Guide

## Purpose

The test strategy defines the **testing approach for a track** — what levels of testing, what coverage targets, what environments, and what tools. It bridges the gap between individual WB test items and the project's overall quality goals.

## Location

`{planning_dir}/{track-name}/test-strategy.md` — one per track, optional (only for tracks with significant testing needs).

## When to Write

- Track has 3+ WB items with test requirements
- Track introduces new test infrastructure (e2e framework, mock server, etc.)
- Track has cross-layer dependencies that need integration testing
- Track modifies code with existing high test coverage (regression risk)

Do NOT write for simple tracks where WB-level test descriptions are sufficient.

## Structure

```markdown
# Test Strategy: {Track Name}

## Coverage Targets

| Metric | Target | Current | Method |
|--------|--------|---------|--------|
| Statement coverage | ≥ 85% | 62% | `vitest --coverage` |
| Branch coverage | ≥ 75% | 48% | `vitest --coverage` |
| Changed file coverage | 100% files have tests | — | RTM forward matrix |

## Test Levels

### Unit Tests
- **Scope**: Individual functions and classes
- **Framework**: vitest
- **Location**: `tests/{module}/*.test.ts`
- **Naming**: `test_{subject}_{scenario}_{expected}`

### Integration Tests
- **Scope**: Cross-module interactions, API endpoints
- **Framework**: vitest + supertest
- **Location**: `tests/integration/*.test.ts`
- **Setup**: Mock server via `createMockServer()` helper

### E2E Tests (if applicable)
- **Scope**: Full user flows through UI
- **Framework**: Playwright
- **Location**: `web/e2e/*.test.ts`
- **Environment**: Requires running dev server

## Test Data

- **Fixtures**: `tests/fixtures/` — static test data files
- **Factories**: `tests/helpers/factories.ts` — dynamic test data generators
- **Mock server**: `tests/helpers/mock-server.ts` — configurable HTTP mock

## Risk-Based Priorities

| Risk Area | Test Focus | WB Items |
|-----------|-----------|----------|
| Auth bypass | Negative auth tests for every new endpoint | OR-3, OR-5 |
| Data corruption | Transaction rollback tests | OR-2 |
| UI regression | Snapshot tests for changed components | FE-1, FE-3 |

## Dependencies

- External services to mock: Redis, PostgreSQL, external APIs
- Test environment requirements: Node.js 20+, Docker (for integration)
- CI considerations: parallel test execution, flaky test quarantine
```

## Writing Principles

1. **Current baseline** — State the current coverage numbers. Without a baseline, targets are meaningless.
2. **Risk-driven** — Focus testing effort on the highest-risk areas. Not all code needs the same coverage.
3. **Concrete locations** — Specify where test files go, what naming convention, what helper utilities exist.
4. **Environment is explicit** — Don't assume the implementer knows what setup is needed. List frameworks, tools, and infrastructure.
5. **Maps to WBs** — The risk priorities table should reference specific WB items so the implementer knows which tests matter most for their assigned work.
