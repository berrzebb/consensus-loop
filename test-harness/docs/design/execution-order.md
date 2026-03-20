# Execution Order

## Tracks

| Track | Description | Prerequisites |
|-------|-------------|---------------|
| data-layer | User entity + repository (persistence abstraction) | none |
| service-layer | Business logic + validation | data-layer |
| api-layer | HTTP routes + error handling | service-layer |

## Dependency Graph

```
data-layer ──→ service-layer ──→ api-layer
```

## Scheduling

1. **Phase 1**: `data-layer` (unblocked, start immediately)
   - DL-1 → DL-2 → DL-3 (sequential within track)
2. **Phase 2**: `service-layer` (unblocked after data-layer completes)
   - SL-1 → SL-2 → SL-3 (sequential within track)
3. **Phase 3**: `api-layer` (unblocked after service-layer completes)
   - AL-1 → AL-2 → AL-3 (sequential within track)

## Parallel Opportunities

- Within a phase, no parallelism (sequential WBs within track)
- Cross-track parallelism only if dependency is satisfied
- Orchestrator may run Track 2 early if Track 1 exports are stable

## Intentional Defects (Test Harness Only)

Three planted defects for audit rejection verification:

| Defect | WB | Type | Expected Rejection Code |
|--------|----|------|------------------------|
| Missing direct test for Validator | SL-2 | test-gap | `test-gap` (T-1 violation) |
| No input sanitization in routes | AL-1 | security-drift | `security` (S-1 violation) |
| Evidence lists file not in git diff | AL-2 | scope-mismatch | `scope-mismatch` (CC-2 violation) |
