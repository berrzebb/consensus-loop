# Evidence Package Format

> Format for evidence packs submitted to `{{CLAUDE_MD_PATH}}` after corrections. Adjust to fit your project.

## Required 5 Sections

1. **Claim** — What was done (concise)
2. **Changed Files** — Full list of modified code/test files
3. **Test Command** — **Only tests related to changed files** (no globs, must include lint command). Full test suite is CI's responsibility, not evidence scope.
4. **Test Result** — Terminal output copy-paste (no estimates/rounding, must include lint pass/fail)
5. **Residual Risk** — What remains open (if exploitable by attacker, it's a fix target, not residual)

## Writing Rules

- `{{CLAUDE_MD_PATH}}` must be **fully replaced via Write tool** — no Edit append.
- Evidence section always **exactly 1** — replace previous section when submitting new.
- Current round items keep `{{TRIGGER_TAG}}`.
- Do not modify design docs.

## Example

```markdown
## {{TRIGGER_TAG}} TRACK-1 — Access control hardening

### Claim
Aligned resource endpoint permissions with claim and added direct tests.

### Changed Files
**Code:** `src/routes/resource.ts`
**Tests:** `tests/resource.test.ts`

### Test Command
```bash
npx eslint src/routes/resource.ts tests/resource.test.ts
npx vitest run tests/resource.test.ts
```

### Test Result
- eslint: passed
- 1 file / 8 tests passed

### Residual Risk
- None
```
