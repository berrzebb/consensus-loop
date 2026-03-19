# Test Harness: 10 Verification Scenarios

## Overview

This test harness validates the consensus-loop full cycle using a 3-track TypeScript project (data-layer → service-layer → api-layer) with 9 work-breakdown items and 3 planted defects.

## Scenario Map

| # | Scenario | Track | Tests | Planted Defect |
|---|----------|-------|-------|----------------|
| 1 | Scout RTM Generation | all | RTM completeness | — |
| 2 | Orchestrator Track Distribution | data-layer | Dependency validation | — |
| 3 | Implementer WB Execution + Verify | data-layer | 8-category verification | — |
| 4 | Audit Rejection (test-gap) | service-layer | T-1 violation | SL-2 missing test |
| 5 | Correction + Resubmission | service-layer | SendMessage correction | — |
| 6 | Audit Approval + Retro + Merge | service-layer | Full back-half cycle | — |
| 7 | Track Auto-Unblock | service-layer → api-layer | Dependency cascade | — |
| 8 | Parallel Distribution | api-layer | Scope overlap + worktree | — |
| 9 | Upstream Delay → Downstream Block | api-layer | 3x rejection → auto-block | AL-1 security |
| 10 | Tech Debt Auto-Capture | api-layer | Residual Risk → catalog | AL-2 scope-mismatch |

---

## Scenario 1: Scout → 3-Way RTM

### Preconditions
- Design docs complete (3 tracks, 9 WBs)
- Source files exist but may be stubs
- No prior RTM exists

### Execution
```
1. Spawn Scout agent (model: opus) against test-harness/
2. Scout reads docs/design/execution-order.md
3. Scout reads each track's work-breakdown.md
4. Scout runs code_map + dependency_graph on src/
5. Scout generates 3 RTM matrices per track (9 total)
```

### Expected Output
- Forward RTM: 9 rows (DL-1 through AL-3), each with File/Exists/Impl/Test columns
- Backward RTM: test files → source files → Req IDs
- Bidirectional: gap analysis (SL-2 has no test file → gap flagged)
- RTM files saved in `docs/design/`

### Success Criteria
- [ ] All 9 WBs present in Forward RTM
- [ ] Each row has correct File path from work-breakdown
- [ ] Exists column accurate (✅ for existing files, ⬜ for stubs)
- [ ] SL-2 test gap detected in Bidirectional summary
- [ ] No invented Req IDs (only DL-1~3, SL-1~3, AL-1~3)

---

## Scenario 2: Orchestrator Track Distribution

### Preconditions
- RTM generated (Scenario 1 complete)
- Session handoff has all 9 tasks with dependency graph

### Execution
```
1. Orchestrator reads session-handoff.md
2. Parses dependency graph → identifies unblocked tasks
3. Only data-layer tasks (DL-1, DL-2, DL-3) are unblocked
4. Spawns implementer for DL-1 (first in sequence)
5. Records agent_id and worktree_path in handoff
```

### Expected Output
- DL-1 status → `in-progress` with agent_id
- DL-2, DL-3 remain `not-started` (sequential within track)
- SL-*, AL-* remain `blocked`
- No parallel spawn (DL items are sequential)

### Success Criteria
- [ ] Only DL-1 assigned (respects sequential within track)
- [ ] agent_id recorded in handoff
- [ ] Blocked tasks not assigned
- [ ] depends_on chain validated before assignment

---

## Scenario 3: Implementer WB Execution + Verify

### Preconditions
- DL-1 assigned to implementer via worktree
- Forward RTM rows for DL-1 provided

### Execution
```
1. Implementer receives DL-1 task + RTM rows
2. Implements src/data/user.ts (factory + types)
3. Runs audit_scan for type-safety
4. Runs verify-implementation (8 categories):
   - CQ: eslint + tsc pass
   - T: tests exist and pass
   - CC: claim matches code
   - CL: no cross-layer impact
   - S: no security issues
   - I: no i18n needed (internal types)
   - CV: coverage ≥ 85% stmt, ≥ 75% branch
   - FV: file verification
5. Updates RTM rows: open → fixed
6. Submits evidence to docs/feedback/claude.md
```

### Expected Output
- Evidence with [REVIEW_NEEDED] tag
- Forward RTM rows with Exists ✅, Impl ✅, Test Case, Test Result
- Test Command section (copy-paste-able)
- Changed Files matching git diff

### Success Criteria
- [ ] Evidence format valid (all required sections present)
- [ ] RTM rows updated to `fixed` status
- [ ] Test commands are literal (no globs)
- [ ] Changed Files matches actual worktree diff
- [ ] All 8 verification categories pass

---

## Scenario 4: Audit Rejection (test-gap)

### Preconditions
- SL-2 (Validator) implemented without direct test file
- Evidence submitted with [REVIEW_NEEDED]
- Forward RTM claims SL-2 is `fixed`

### Execution
```
1. Audit triggered by evidence write
2. GPT/Codex reads evidence + verifies each RTM row
3. For SL-2: checks tests/service/validator.test.ts → file missing
4. T-1 violation detected: no direct test for Validator module
5. Issues [CHANGES_REQUESTED] with rejection code `test-gap`
```

### Expected Output
- gpt.md contains `[CHANGES_REQUESTED]` for SL-2
- Rejection code: `test-gap`
- Completion Criteria Reset: "Create tests/service/validator.test.ts"
- SL-1, SL-3 may be [APPROVED] if correct

### Success Criteria
- [ ] SL-2 rejected with `test-gap` code
- [ ] Rejection includes file:line evidence
- [ ] Completion Criteria Reset section present
- [ ] Other passing WBs not affected
- [ ] audit-history.jsonl entry recorded

---

## Scenario 5: Correction + Resubmission (SendMessage)

### Preconditions
- Scenario 4 complete: SL-2 has [CHANGES_REQUESTED]
- Implementer agent still alive (same agent_id)

### Execution
```
1. Orchestrator detects [CHANGES_REQUESTED] for SL-2
2. Sends correction via SendMessage (same agent_id, not new spawn)
3. Implementer creates tests/service/validator.test.ts
4. Runs verify-implementation again
5. Updates RTM rows
6. Resubmits evidence with [REVIEW_NEEDED]
```

### Expected Output
- New evidence in claude.md with updated RTM
- tests/service/validator.test.ts exists and passes
- Same agent_id used (no new spawn)

### Success Criteria
- [ ] SendMessage used (not new Agent spawn)
- [ ] New test file created and passes
- [ ] RTM rows updated with test case reference
- [ ] Evidence resubmitted with corrected sections
- [ ] Correction count tracked in audit-history

---

## Scenario 6: Audit Approval + Retro + Merge

### Preconditions
- Scenario 5 complete: corrected evidence submitted
- All SL-* items now meet done criteria

### Execution
```
1. Audit re-runs on corrected evidence
2. All criteria pass → [APPROVED]
3. respond.mjs syncs [APPROVED] to claude.md
4. retrospective.mjs writes retro-marker.json
5. session-gate blocks until retro completes
6. User/orchestrator completes retrospective
7. Merge skill: squash merge worktree → main
```

### Expected Output
- gpt.md: [APPROVED] for all SL-* items
- claude.md: tags promoted to [APPROVED]
- retro-marker.json: status `retro_pending`
- After retro: session-gate unblocked
- Worktree merged to main branch

### Success Criteria
- [ ] All SL-* items [APPROVED]
- [ ] Retro marker created
- [ ] Session gate blocks correctly
- [ ] Retro completion clears gate
- [ ] Squash merge produces single commit
- [ ] Main branch has all SL-* code

---

## Scenario 7: Track Auto-Unblock

### Preconditions
- data-layer fully complete and merged
- service-layer fully complete and merged
- api-layer still `blocked` in handoff

### Execution
```
1. Orchestrator re-reads handoff after service-layer merge
2. Checks api-layer depends_on: service-layer
3. service-layer status = done → api-layer unblocked
4. Updates api-layer status: blocked → not-started
5. Begins AL-1 assignment
```

### Expected Output
- Handoff updated: api-layer `not-started`
- AL-1 eligible for assignment
- AL-2, AL-3 remain sequential after AL-1

### Success Criteria
- [ ] Automatic status transition (no manual intervention)
- [ ] Correct dependency check (service-layer done)
- [ ] Only AL-1 assigned (sequential within track)
- [ ] Handoff reflects new state

---

## Scenario 8: Parallel Distribution (Scope Validation)

### Preconditions
- Multiple unblocked WBs available
- Orchestrator has scope overlap detection

### Execution
```
1. If DL-1, DL-2, DL-3 were independent (hypothetical):
   - Orchestrator checks file overlap via dependency_graph
   - No overlap → parallel spawn allowed
   - Overlap detected → sequential fallback
2. Each parallel worker gets isolated worktree
3. RTM merge after both complete (rtm_merge tool)
```

### Expected Output
- Worktree isolation: each worker has own copy
- Evidence files don't collide (worktree-local)
- RTM merge detects/resolves conflicts

### Success Criteria
- [ ] Scope overlap detection runs before parallel spawn
- [ ] Worktree isolation prevents file collision
- [ ] rtm_merge correctly merges parallel RTM updates
- [ ] Conflict detection flags overlapping rows
- [ ] Sequential fallback if overlap detected

---

## Scenario 9: Upstream Delay → Downstream Block

### Preconditions
- AL-1 (Routes) submitted 3+ times, each rejected with `security`
- Audit history has ≥ 3 pending rejections for api-layer

### Execution
```
1. enforcement.mjs countTrackPendings("api-layer") ≥ 3
2. Upstream delay threshold reached
3. blockDownstreamTasks() marks AL-2, AL-3 as blocked
4. Handoff updated with block reason
5. Orchestrator notified of upstream delay
```

### Expected Output
- AL-2, AL-3 status → `blocked` with reason "upstream delay: AL-1 (3+ rejections)"
- Audit history records security rejection pattern
- Orchestrator reports delay to user

### Success Criteria
- [ ] 3+ rejections trigger upstream delay
- [ ] Downstream tasks auto-blocked
- [ ] Block reason recorded in handoff
- [ ] Security rejection code tracked in audit_history
- [ ] Orchestrator surfaces delay notification

---

## Scenario 10: Tech Debt Auto-Capture

### Preconditions
- AL-2 (ErrorHandler) evidence has Residual Risk section
- Evidence mentions `src/api/middleware.ts` (scope-mismatch defect)
- work-catalog.md exists (or will be created)

### Execution
```
1. Evidence submitted with Residual Risk:
   "AL-3: deferred — depends on AL-2 completion"
   "middleware.ts: tech debt — needs refactoring"
2. enforcement.mjs parseResidualRisk() extracts items
3. appendTechDebt() adds to work-catalog.md
4. Audit catches scope-mismatch (middleware.ts not in git diff)
5. Rejection triggers correction cycle
```

### Expected Output
- work-catalog.md has new tech debt entry
- Audit rejects with `scope-mismatch` for middleware.ts
- Correction removes false file reference

### Success Criteria
- [ ] Residual Risk parsed correctly
- [ ] Tech debt auto-appended to work-catalog.md
- [ ] scope-mismatch rejection code issued
- [ ] Correction removes incorrect file reference
- [ ] Updated evidence passes re-audit

---

## Running the Test Harness

### Prerequisites
```bash
cd test-harness/
npm install
npm run quality  # Verify project builds + tests pass
```

### Full Cycle Execution

1. **Scout**: Spawn scout agent against `test-harness/`
2. **Orchestrator**: Start orchestrator, distribute Track 1
3. **Implement Track 1**: DL-1 → DL-2 → DL-3 (happy path, Scenarios 1-3)
4. **Implement Track 2**: SL-1 → SL-2 (planted test-gap) → SL-3 (Scenarios 4-6)
5. **Implement Track 3**: AL-1 (planted security) → AL-2 (planted scope-mismatch) → AL-3 (Scenarios 7-10)

### Verification Checklist

After completing all scenarios:
- [x] audit-history.jsonl has entries for all 9 WBs
- [x] At least 2 rejection → correction cycles completed (SL-2 test-gap, AL-1 security x3, AL-2 scope-mismatch)
- [x] work-catalog.md has auto-captured tech debt (3 items + 1 added)
- [x] All 3 planted defects caught by auditor (test-gap, security, scope-mismatch)
- [x] Downstream auto-block triggered at least once (AL-2 blocked by AL-1 upstream delay)
- [x] Session handoff reflects final state (data-layer done, service-layer done, api-layer in-progress)
- [x] `npm run quality` passes in final state (44 tests, 4 files)

---

## Execution Results (2026-03-19)

### Summary

| # | Scenario | Result | Key Finding |
|---|----------|--------|-------------|
| 1 | Scout RTM Generation | PASS | 9 WB → 3-way RTM, 2 gaps detected (SL-2 test, AL-1 validation) |
| 2 | Orchestrator Distribution | PASS | data-layer only unblocked, DL-1 assigned |
| 3 | Implementer Execute + Verify | PASS | 8-category verify, 12 tests, evidence format valid |
| 4 | Audit Rejection (test-gap) | PASS | SL-2 rejected with `test-gap`, Criteria Reset present |
| 5 | Correction + Resubmission | PASS | validator.test.ts created (10 tests), evidence resubmitted |
| 6 | Approval + Retro + Merge | PASS | All SL-* approved, service-layer done, api-layer unblocked |
| 7 | Track Auto-Unblock | PASS | api-layer: blocked → not-started (automatic) |
| 8 | Parallel Distribution | PASS | Scope overlap detected (routes↔error-handler), sequential fallback |
| 9 | Upstream Delay | PASS | 3x security rejection → AL-2 auto-blocked |
| 10 | Tech Debt Auto-Capture | PASS | 3 residual risk items → work-catalog, duplicate prevention verified |

### Bonus Finding

- **verdict convention mismatch**: audit-history.jsonl uses `"pending"`/`"agree"` internally, not `"CHANGES_REQUESTED"`/`"APPROVED"`. This two-layer convention (markdown tags vs JSONL verdicts) was initially misidentified as a bug in `countTrackPendings()` but turned out to be correct behavior.

### Final State

- **Tests**: 44 pass (4 files: repository, user-service, validator, routes)
- **audit-history.jsonl**: 9 entries (5 agree, 4 pending including 1 corrected)
- **work-catalog.md**: 4 tech debt items auto-captured
- **Planted defects**: 3/3 caught (test-gap, security, scope-mismatch)

### Screenshots

| File | Content |
|------|---------|
| `th-01-harness-requirements.png` | Requirements: 3 tracks, 10 scenarios, 3 planted defects |
| `th-02-project-complete.png` | Project structure + 34 tests + defect table |
| `th-03-scout-mcp-tools.png` | Scout: code_map + dependency_graph MCP execution |
| `th-04-rtm-matrices.png` | Forward/Backward RTM for data-layer |
| `th-05-audit-test-gap-rejection.png` | SL-2 test-gap rejection verdict table |
| `th-06-correction-cycle-approval.png` | Tag promotion + audit-history correction round 2 |
| `th-07-scope-overlap-validation.png` | Scope overlap detection → sequential fallback |
| `th-08-upstream-delay-enforcement.png` | 3x rejection → downstream auto-block |
