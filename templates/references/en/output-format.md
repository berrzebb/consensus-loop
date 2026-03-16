# Audit Response Format

> Write `{{GPT_MD_PATH}}` following this format. Adjust sections to fit your project.

## Timestamp

- Audit completion timestamp is **added automatically by the system** — do not write it manually.
- Format: `> Audit completed: YYYY-MM-DD HH:MM` (auto-appended to bottom of gpt.md)

## Required Sections (keep only these)

1. `## Audit Scope`
2. `## Independent Verification`
3. `## Final Verdict`
4. `## Rejection Codes` (`{{PENDING_TAG}}` only)
5. `## Specific Locations` (`{{PENDING_TAG}}` only)
6. `## Key Evidence` (3–5 lines)
7. `## Completion Criteria Reset` (`{{PENDING_TAG}}` only)
8. `## Next Task`

## Example: {{PENDING_TAG}} Verdict

```markdown
## Audit Scope
- [pending] TRACK-1 — Access control hardening

## Independent Verification
- Per-file `npx eslint` on 10 changed files: all passed.
- `npx vitest run ...` → 8 files / 120 tests passed.
- `npx tsc --noEmit` passed.

## Final Verdict
- [pending] TRACK-1 — Access control hardening

## Rejection Codes
- `scope-mismatch [major]`
- `test-gap [major]`

## Specific Locations
- `src/routes/resource.ts:L42` — claim says require_admin but actual is require_member
- `tests/resource.test.ts:L85` — missing admin 403 verification

## Key Evidence
- Lint, tsc, vitest all passed.
- However, GET /api/resource claim vs actual permission mismatch.
- Tests retain old member expectation, failing to lock the claim.

## Completion Criteria Reset
- Align resource permissions with claim and add 403/200 tests.

## Next Task
- TRACK-1 — Change GET /api/resource permission in `src/routes/resource.ts` + add verification in `tests/resource.test.ts`
```

## Example: {{AGREE_TAG}} Verdict

```markdown
## Audit Scope
- [agreed] TRACK-1 — Access control hardening

## Independent Verification
- Per-file eslint on 10 files: passed.
- vitest 8 files / 120 tests passed.
- Claim-code alignment confirmed.

## Final Verdict
- [agreed] TRACK-1 — Access control hardening

## Key Evidence
- Scope guards confirmed on all endpoints. Claim-code alignment satisfied.

## Next Task
- TRACK-2 — Next unresolved item
```

## Regression Follow-up Format

When regression found on existing `{{AGREE_TAG}}` item:
```
- {{PENDING_TAG}} Regression Follow-up / TRACK-R1 — Regression from subsequent changes
```

## Prohibited

- Do not create `## Improved Protocol` section (delete if exists).
- No vague next-task descriptions (`maintain separate audit`, `continue`, `follow up`).
