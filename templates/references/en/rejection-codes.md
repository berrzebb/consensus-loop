# Rejection Codes

> Modify this file to adjust rejection criteria for your project.

## Code List

| Code | Description | Severity Criteria | Risk Level |
|------|-------------|-------------------|------------|
| `needs-evidence` | Evidence package missing or weak | `[major]`: core claim unsupported / `[minor]`: partial gaps | low |
| `scope-mismatch` | Claim vs actual code mismatch | `[major]`: critical path mismatch / `[minor]`: doc wording diff | medium |
| `lint-gap` | Lint not run or failed | `[major]`: exit code ≠ 0 | low |
| `test-gap` | Tests missing or insufficient | `[major]`: critical path untested / `[minor]`: edge case missing | medium |
| `claim-drift` | Doc and code behavior diverge | `[major]`: behavioral diff / `[minor]`: doc typo | low |
| `principle-drift` | SOLID/YAGNI/DRY/KISS/LoD structural regression | `[major]`: structural regression / `[minor]`: minor violation | medium |
| `security-drift` | OWASP TOP 10 violation or attacker-perspective vulnerability | `[major]`: always | **critical** |
| `coverage-gap` | Changed file coverage below threshold | `[major]`: stmt < 85% or branch < 75% / `[minor]`: within 5% of threshold | low |

## Risk Levels

| Level | Meaning | Accumulation Action |
|-------|---------|--------------------|
| **low** | Isolated issue, fix and move on | No escalation |
| **medium** | Pattern risk — may indicate structural problem | 3+ medium rejections on same track → warn orchestrator |
| **high** | Cross-track impact or regression risk | Block downstream tracks until resolved |
| **critical** | Security vulnerability or data integrity risk | Block entire track, escalate to user immediately |

## Risk Pattern Detection

The orchestrator should monitor rejection patterns across rounds:

- **Same code on same file 2+ rounds** → escalate from low to medium (approach needs rethinking)
- **Same rejection code 3+ times on same track** → structural issue, suggest planner re-scoping
- **`security-drift` on any round** → auto-escalate to critical, block track
- **`test-gap` + `coverage-gap` on same file** → compound risk, flag for review

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
