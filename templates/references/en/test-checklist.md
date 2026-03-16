# Test Sufficiency Checklist

> Review this checklist before issuing `test-gap`. Add/modify items to fit your project.

## Required Checks

- [ ] **Retry/repair call count**: Test verifies invocation count, not just success/failure
- [ ] **Boundary cases**: Tie / empty input / all-fail edge cases covered
- [ ] **Error paths**: Tests directly exercise error-producing scenarios
- [ ] **Claim-code alignment**: Residual risk and claim descriptions match actual code behavior
- [ ] **Bonus fix coverage**: If bonus fixes exist, dedicated tests for those functions included

## Verdict Criteria

- Any item missing → `test-gap [major]`
- Doc-only mismatch → `claim-drift [minor]` (separate)
