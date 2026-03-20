# done-criteria 예제 (한국어)

이 파일을 `templates/references/ko/done-criteria.md`로 복사하고 프로젝트에 맞게 수정하세요.

구현자(Claude)와 감사자(GPT/Codex)가 공유하는 "완료" 정의 계약입니다.
- **Done Criteria**: 구현자가 증거 제출 전 확인하는 체크리스트
- **Not-Done Criteria**: 감사자가 반려 시 사용하는 rejection code
- 프로젝트 도구에 맞게 lint/test 명령을 조정하세요 (예: `eslint` → `cargo clippy`, `vitest` → `pytest`)

---

# Definition of Done

> Shared contract between implementer (Claude) and auditor (GPT/Codex).
> Both sides reference this document. Done = provable. Not-Done = falsifiable.

## Principle

- **Done** = "I can prove every criterion with reproducible evidence"
- **Not-Done** = "I can point to a specific file:line where a criterion fails"
- Neither side uses "I think" — only "I verified" or "I found"

---

## Done Criteria (implementer checklist)

Submit evidence only when ALL items pass.

### Code Quality

| # | Criterion | Proof |
|---|-----------|-------|
| CQ-1 | Every changed file passes `npx eslint <file>` individually | Per-file eslint output |
| CQ-2 | `npx tsc --noEmit` passes | Terminal output |
| CQ-3 | No unused imports/variables in changed files | Covered by CQ-1 |
| CQ-4 | No `as any`, `@ts-ignore`, `console.log` in new code | Grep result |

### Test

| # | Criterion | Proof |
|---|-----------|-------|
| T-1 | All test commands in evidence execute and pass | Terminal output (copy-paste, not summary) |
| T-2 | Every claimed feature has a direct test (not just indirect coverage) | Test file:line reference |
| T-3 | No existing test regressions in related scope | `npx vitest run <related>` output |
| T-4 | Test commands are re-runnable as-is (no glob patterns, no environment assumptions) | Command is copy-pasteable |

### Claim-Code Consistency

| # | Criterion | Proof |
|---|-----------|-------|
| CC-1 | Claim text matches actual code behavior | Changed file:line references |
| CC-2 | Changed Files list matches the diff scope — use evidence's diff basis commit range (e.g. `git diff --name-only <base>..<head>`) when available, otherwise `git diff --name-only` for uncommitted changes | Diff output |
| CC-3 | Residual Risk reflects actual unresolved items (no over/under-stating) | Code state |

### Cross-Layer Contract

| # | Criterion | Proof |
|---|-----------|-------|
| CL-1 | BE change → FE-required fields/API documented in evidence | "BE produces X → FE consumes X" |
| CL-2 | New interface/port → at least one consumer exists | Import reference |
| CL-3 | Infra change → affected consumers listed | Dependency trace |

### Security

| # | Criterion | Proof |
|---|-----------|-------|
| S-1 | New input path → validation exists | Validator file:line |
| S-2 | New API endpoint → auth/permission guard applied | Guard file:line |
| S-3 | Sensitive data → not exposed in logs/responses | Grep for field name in log/response paths |

### i18n / Open Source

| # | Criterion | Proof |
|---|-----------|-------|
| I-1 | User-facing strings → locale keys (not hardcoded) | Locale file reference |
| I-2 | New locale keys → present in ALL supported locales | ko.json + en.json both contain key |

---

## Not-Done Criteria (auditor rejection codes)

Reject with specific file:line evidence.

| Code | Severity | Trigger | Required Evidence |
|------|----------|---------|-------------------|
| `lint-gap` | major | CQ-1 or CQ-2 fails on independent re-execution | Failing file:line + error message |
| `test-gap` | major | T-1 fails, or T-2 not met (claimed feature has no direct test) | Missing test description + what should be tested |
| `claim-drift` | minor | CC-1 fails (evidence says X, code does Y) | Evidence quote vs actual code |
| `scope-mismatch` | major | CC-2 fails (files in diff not in Changed Files, or vice versa) | Diff output vs evidence list |
| `regression` | major | T-3 fails (existing test broke) | Failing test file:line |
| `security` | critical | S-1/S-2/S-3 fails | Vulnerable code file:line + attack scenario |
| `i18n-gap` | minor | I-1 or I-2 fails | Hardcoded string location |
| `contract-gap` | major | CL-1/CL-2/CL-3 fails | Missing contract description |

---

## Quick Audit (pre-flight, zero cost)

The hook runs these checks automatically before triggering the auditor:

- Changed Files exist on disk
- Changed Files vs git diff consistency
- Tag conflict detection
- Backtick path format validation
- Required sections present (configurable via `consensus.evidence_sections`)

If quick audit finds warnings, they are displayed but do not block the audit.
Fix them before submission to save audit cost.

---

## Usage

### Implementer (Claude)
1. Before submitting evidence, verify every Done criterion
2. Include proof for each (terminal output, file:line references)
3. If a criterion cannot be met, document it in Residual Risk

### Auditor (GPT/Codex)
1. Re-execute all test commands independently
2. Check each Done criterion against actual code
3. Reject with specific rejection code + file:line evidence
4. Do not reject without pointing to a failing criterion

### Both
- This document is the single source of truth for "done"
- If a criterion is missing, propose an addition — do not invent ad hoc criteria
