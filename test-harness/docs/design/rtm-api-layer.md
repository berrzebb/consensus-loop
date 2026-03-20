# Forward RTM: api-layer

| Req ID | Description | Track | Design Ref | File | Exists | Impl | Test Case | Test Result | Connected | Status |
|--------|-------------|-------|------------|------|--------|------|-----------|-------------|-----------|--------|
| AL-1 | Route handlers (POST/GET/PUT/DELETE /users) | api-layer | api-layer/work-breakdown.md | src/api/routes.ts | ✅ | ⚠️ | tests/api/routes.test.ts | — | AL-2:src/api/error-handler.ts | open |
| AL-1 | Request/Response types | api-layer | api-layer/work-breakdown.md | src/api/routes.ts | ✅ | ✅ | tests/api/routes.test.ts | — | AL-2:src/api/error-handler.ts | open |
| AL-2 | handleError function | api-layer | api-layer/work-breakdown.md | src/api/error-handler.ts | ✅ | ✅ | tests/api/routes.test.ts | — | AL-3:tests/api/routes.test.ts | open |
| AL-2 | wrapHandler function | api-layer | api-layer/work-breakdown.md | src/api/error-handler.ts | ✅ | ✅ | tests/api/routes.test.ts | — | AL-3:tests/api/routes.test.ts | open |
| AL-3 | API integration tests | api-layer | api-layer/work-breakdown.md | tests/api/routes.test.ts | ✅ | ✅ | self | — | — | open |

### Notes

- **AL-1 Impl = ⚠️**: Route handlers exist but `createRoutes()` does **not call Validator** before passing input to service. Work-breakdown requires: "Must validate input via Validator before passing to service (security requirement)". The import `validateCreateInput` is absent from `src/api/routes.ts`.
- This is a **security gap** (S-1) that the auditor should catch during verification.

## Legend

- **Exists**: ✅ file present, ❌ missing
- **Impl**: ✅ all exports present, ⚠️ partial (missing validation), ❌ missing
- **Test Case**: test file path, `self` if row IS a test, ❌ if no direct test
- **Test Result**: ✓ pass, ✗ fail, — not yet run
- **Connected**: `{downstream-req}:{consumer-file}` via import
- **Status**: open → wip → fixed → verified

---

# Backward RTM: api-layer

| Test File | Test Description | Source File | Impl Function | Req ID | Design Ref | Traced |
|-----------|-----------------|-------------|---------------|--------|------------|--------|
| tests/api/routes.test.ts | POST/GET/PUT/DELETE handlers | src/api/routes.ts | createRoutes() | AL-1 | api-layer/work-breakdown.md | ✅ |
| tests/api/routes.test.ts | error handling through wrapHandler | src/api/error-handler.ts | wrapHandler(), handleError() | AL-2 | api-layer/work-breakdown.md | ✅ |
| tests/api/routes.test.ts | full CRUD lifecycle | src/api/routes.ts, src/api/error-handler.ts | createRoutes(), wrapHandler() | AL-3 | api-layer/work-breakdown.md | ✅ |

---

# Bidirectional RTM: api-layer

| Req ID | Description | Has Code | Has Test | Test → Req Traced | Req → Test Traced | Gap |
|--------|-------------|----------|----------|-------------------|-------------------|-----|
| AL-1 | Route handlers + types | ✅ | ✅ | ✅ | ✅ | **impl partial** (no validation) |
| AL-2 | handleError + wrapHandler | ✅ | ✅ | ✅ | ✅ | — |
| AL-3 | API integration tests | ✅ (self) | ✅ (self) | ✅ | ✅ | — |

**Summary**:
- **1 implementation gap**: AL-1 routes do not call `validateCreateInput()` before service calls
- Work-breakdown explicitly requires input validation guard (S-1 security requirement)
- All test files trace back to requirements — no orphans
