# Rejection Codes

> Modify this file to adjust rejection criteria for your project.

## Code List

| Code | Description | Severity Criteria |
|------|-------------|-------------------|
| `needs-evidence` | Evidence package missing or weak | `[major]`: core claim unsupported / `[minor]`: partial gaps |
| `scope-mismatch` | Claim vs actual code mismatch | `[major]`: critical path mismatch / `[minor]`: doc wording diff |
| `lint-gap` | Lint not run or failed | `[major]`: exit code ≠ 0 |
| `test-gap` | Tests missing or insufficient | `[major]`: critical path untested / `[minor]`: edge case missing |
| `claim-drift` | Doc and code behavior diverge | `[major]`: behavioral diff / `[minor]`: doc typo |
| `principle-drift` | SOLID/YAGNI/DRY/KISS/LoD structural regression | `[major]`: structural regression / `[minor]`: minor violation |
| `security-drift` | OWASP TOP 10 violation or attacker-perspective vulnerability | `[major]`: always |
| `coverage-gap` | Changed file coverage below threshold | `[major]`: stmt < 85% or branch < 75% / `[minor]`: within 5% of threshold |

## Usage Rules

- Select 1–3 codes on `{{PENDING_TAG}}` verdict. Severity `[major]`/`[minor]` required.
- `[major]`: blocks `{{AGREE_TAG}}` in next round.
- `[minor]`: passable after fix confirmation.
- `lint-gap` requires specific location (file:L{line} + error message). Summary-only ("N issues") not allowed.

## Specific Location Format

On rejection, cite exact locations in `## Specific Locations`:
```
- `src/routes/resource.ts:L42` — claim says require_admin but actual is require_member
- `tests/resource.test.ts:L85` — verifies member 200 only, missing admin 403
```
