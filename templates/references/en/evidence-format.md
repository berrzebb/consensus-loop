# Evidence Package Format

> Format for evidence packs submitted to `{{CLAUDE_MD_PATH}}`. Adjust to fit your project.

## Required Sections

1. **Forward RTM Rows** — Updated rows from the Forward RTM for this submission (Req ID × File × Status). This is the primary evidence — the auditor verifies each row.
2. **Claim** — What was done, referencing RTM Req IDs (concise)
3. **Changed Files** — Full list of modified code/test files (must match RTM rows)
4. **Test Command** — **Only tests related to changed files** (no globs, must include lint command). Full test suite is CI's responsibility, not evidence scope.
5. **Test Result** — Terminal output copy-paste (no estimates/rounding, must include lint pass/fail)
6. **Residual Risk** — **ALL** unaddressed RTM rows for this track with reason. This includes rows NOT in the current submission. The auditor uses this to verify that gaps are acknowledged, not silently dropped. Format: `Req ID: status (partial-impl/partial-wiring/missing) — reason`

## Writing Rules

- `{{CLAUDE_MD_PATH}}` must be **fully replaced via Write tool** — no Edit append.
- Evidence section always **exactly 1** — replace previous section when submitting new.
- Current round items keep `{{TRIGGER_TAG}}`.
- Do not modify design docs.
- Forward RTM rows must match the scout-generated RTM — do not invent Req IDs.

## Example

```markdown
## {{TRIGGER_TAG}} evaluation-pipeline — EV-1, EV-2

### Forward RTM Rows

| Req ID | File | Exists | Impl | Test Case | Test Result | Status |
|--------|------|--------|------|-----------|-------------|--------|
| EV-1 | src/evals/contracts.ts | ✅ | ✅ | tests/evals/loader.test.ts | ✓ pass | fixed |
| EV-1 | src/evals/loader.ts | ✅ | ✅ | tests/evals/loader.test.ts | ✓ pass | fixed |
| EV-2 | src/evals/runner.ts | ✅ | ✅ | tests/evals/runner.test.ts | ✓ pass | fixed |

### Claim
Implemented EvalCase contract (EV-1) and local runner (EV-2). Both traced to tests.

### Changed Files
**Code:** `src/evals/contracts.ts`, `src/evals/loader.ts`, `src/evals/runner.ts`
**Tests:** `tests/evals/loader.test.ts`, `tests/evals/runner.test.ts`

### Test Command
```bash
# Use project-appropriate commands. Examples:
# JS/TS: npx eslint <files> + npx vitest run <tests> + npx tsc --noEmit
# Python: ruff check <files> + python -m pytest <tests>
# Rust: cargo clippy + cargo test
npx eslint src/evals/contracts.ts src/evals/loader.ts src/evals/runner.ts
npx vitest run tests/evals/loader.test.ts tests/evals/runner.test.ts
npx tsc --noEmit
```

### Test Result
- eslint: passed
- 3 files / 24 tests passed
- tsc: passed

### Residual Risk
- EV-3: missing — depends on EV-2 completion (deferred to next batch)
- EV-4: partial-wiring — code exists but not imported by orchestrator.ts (next track scope)
```
