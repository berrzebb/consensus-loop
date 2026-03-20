# Requirements Traceability Matrix (RTM)

> Single source of truth for the consensus loop.
> Three matrices provide complete coverage: forward, backward, bidirectional.

## Source Documents

| Document | Role |
|----------|------|
| `execution-order.md` | Track ordering + dependency graph |
| `{domain}/README.md` | Track scope, boundaries, done criteria |
| `{domain}/work-breakdown.md` | **Req ID origin** — files, implementation items, tests, done criteria per package |
| `work-catalog.md` | Cross-track ID index (A1, B2, EV-3...) |
| `feedback-promotion.md` | Auto-promotion to next track after consensus |

---

## 1. Forward Traceability Matrix

**Question**: "Is every requirement implemented and tested?"
**Direction**: Requirement → Design → Code → Test

Detects: **implementation gaps, missing tests, unconnected outputs**

```markdown
# Forward RTM: [track-name]

| Req ID | Description | Track | Design Ref | File | Exists | Impl | Test Case | Test Result | Connected | Status |
|--------|-------------|-------|------------|------|--------|------|-----------|-------------|-----------|--------|
| EV-1 | EvalCase contract | evaluation-pipeline | EV/README | src/evals/types.ts | ❌ | — | — | — | EV-2:runner.ts | open |
| EV-1 | fixture loader | evaluation-pipeline | EV/README | src/evals/loaders.ts | ❌ | — | — | — | EV-2:runner.ts | open |
| EV-1 | loader contract test | evaluation-pipeline | EV/README | tests/evals/loaders.test.ts | ❌ | — | self | — | — | open |
| EV-2 | local runner | evaluation-pipeline | EV/README | src/evals/runner.ts | ❌ | — | — | — | EG-5:regression | open |
```

### Column Definitions

| Column | Owner | Description |
|--------|-------|-------------|
| **Req ID** | work-breakdown.md | Immutable. Origin: `{domain}/work-breakdown.md` |
| **Description** | work-breakdown.md | Implementation item from "구현 내용" |
| **Track** | execution-order.md | Domain folder name |
| **Design Ref** | README.md | Design document section reference |
| **File** | work-breakdown.md | Target file from "첫 수정 파일" / "경계" / "프론트엔드" |
| **Exists** | scout | ✅ / ❌ — checked against actual codebase |
| **Impl** | scout | ✅ complete / ⚠️ partial / ❌ missing / — (file absent) |
| **Test Case** | scout → implementer | Test file:line, `self` if row IS a test, — if absent |
| **Test Result** | implementer | ✓ pass / ✗ fail / — pending |
| **Connected** | scout | Downstream consumer `Req ID:file` via import tracing |
| **Coverage** | coverage_map tool | stmt% / br% / fn% from vitest coverage JSON |
| **Status** | all | open → wip → fixed → verified |

---

## 2. Backward Traceability Matrix

**Question**: "Does every test/code trace back to a requirement?"
**Direction**: Test → Code → Design → Requirement

Detects: **orphan tests, dead code, unnecessary implementations**

```markdown
# Backward RTM: [track-name]

| Test File | Test Description | Source File | Impl Function | Req ID | Design Ref | Traced |
|-----------|-----------------|-------------|---------------|--------|------------|--------|
| tests/evals/loaders.test.ts | loader contract | src/evals/loaders.ts | loadDataset() | EV-1 | EV/README | ✅ |
| tests/evals/runner.test.ts | smoke test | src/evals/runner.ts | runEval() | EV-2 | EV/README | ✅ |
| tests/bus/orphan.test.ts | legacy test | src/bus/old.ts | — | — | — | ❌ orphan |
```

### Column Definitions

| Column | Owner | Description |
|--------|-------|-------------|
| **Test File** | scout | Existing test file in codebase |
| **Test Description** | scout | What the test verifies |
| **Source File** | scout | Implementation file the test imports |
| **Impl Function** | scout | Specific function/class under test |
| **Req ID** | scout | Traced back to work-breakdown. — if no match |
| **Design Ref** | scout | Design document. — if no match |
| **Traced** | scout | ✅ fully traced / ⚠️ partial / ❌ orphan (no requirement) |

---

## 3. Bidirectional Traceability Matrix

**Question**: "Are requirements and tests fully connected without gaps?"
**Direction**: Requirement ↔ Test (cross-reference)

Detects: **coverage gaps in both directions simultaneously**

```markdown
# Bidirectional RTM: [track-name]

| Req ID | Description | Has Code | Has Test | Test → Req Traced | Req → Test Traced | Gap |
|--------|-------------|----------|----------|-------------------|-------------------|-----|
| EV-1 | EvalCase contract | ❌ | ❌ | — | — | code + test missing |
| EV-2 | local runner | ❌ | ❌ | — | — | code + test missing |
| — | — | ✅ | ✅ | ❌ | — | orphan test (no req) |
```

### Column Definitions

| Column | Description |
|--------|-------------|
| **Req ID** | From work-breakdown. `—` for orphan code/tests |
| **Description** | Requirement description or orphan item description |
| **Has Code** | ✅ implementation exists / ❌ missing |
| **Has Test** | ✅ test exists / ❌ missing |
| **Test → Req Traced** | Backward: test traces back to this requirement |
| **Req → Test Traced** | Forward: requirement has a covering test |
| **Gap** | Summary of what's missing |

---

## Scout Procedure

The scout reads ALL tracks and produces all three matrices.

### 1. Build dependency graph
Read `execution-order.md` → map track dependencies and downstream consumers.

### 2. Read each track's work-breakdown
For each Req ID, extract:
- Target files ("첫 수정 파일", "경계", "프론트엔드")
- Implementation items ("구현 내용")
- Test descriptions ("테스트")
- Done criteria ("완료 기준")
- Prerequisites ("선행 조건")

### 3. Forward scan (requirement → code)
For each Req ID × File: check Exists, Impl, Test Case, Connected.

### 4. Backward scan (test → requirement)
For each existing test file in the track's scope:
- Trace imports back to source files
- Match source files to Req IDs from work-breakdown
- Flag orphan tests with no requirement match

### 5. Bidirectional summary
Cross-reference forward and backward results to produce the gap analysis.

### 6. Cross-track connection audit
From execution-order dependencies, trace import chains across tracks.

## Lifecycle

| Phase | Actor | Action |
|-------|-------|--------|
| **Generate** | scout | Produces all 3 matrices from work-breakdown vs codebase |
| **Distribute** | orchestrator | Assigns Forward RTM rows to implementers |
| **Implement** | implementer | Updates Forward RTM: Exists, Impl, Test Case, Test Result |
| **Verify** | auditor | Uses Backward RTM to verify each fix traces to a requirement |
| **Correct** | implementer | Only ❌ verdict rows re-enter cycle |
| **Close** | orchestrator | Bidirectional RTM shows zero gaps → track complete |

## Incremental Update

When the planner adds new work packages:
- Scout appends only NEW Req ID rows to Forward RTM
- Re-runs backward scan for new test files only
- Regenerates bidirectional summary
- Existing rows unchanged — no full rescan

## Evidence Submission

The Forward RTM is the primary evidence. Submit to watch_file:

```markdown
## [trigger_tag] [track-name] — Req IDs addressed

### Forward Traceability Matrix
(updated rows for this submission)

### Test Command
(commands to verify the fixed rows)

### Test Result
(terminal output)

### Residual Risk
Rows not addressed: EV-3 (deferred — depends on EV-2)
```

## Token Efficiency

Cost per matrix is deterministic: `rows × ~130 chars/row`.
Three matrices for a 30-row track ≈ 3,000 tokens total — fixed.
Scout cost: one-time, amortized across all sessions.
