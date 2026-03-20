# Forward RTM: service-layer

| Req ID | Description | Track | Design Ref | File | Exists | Impl | Test Case | Test Result | Connected | Status |
|--------|-------------|-------|------------|------|--------|------|-----------|-------------|-----------|--------|
| SL-1 | UserService business logic | service-layer | service-layer/work-breakdown.md | src/service/user-service.ts | ✅ | ✅ | tests/service/user-service.test.ts | ✓ pass | AL-1:src/api/routes.ts | verified |
| SL-1 | ServiceError class | service-layer | service-layer/work-breakdown.md | src/service/user-service.ts | ✅ | ✅ | tests/service/user-service.test.ts | ✓ pass | AL-2:src/api/error-handler.ts | verified |
| SL-2 | validateEmail function | service-layer | service-layer/work-breakdown.md | src/service/validator.ts | ✅ | ✅ | tests/service/validator.test.ts | ✓ pass | — | verified |
| SL-2 | validateName function | service-layer | service-layer/work-breakdown.md | src/service/validator.ts | ✅ | ✅ | tests/service/validator.test.ts | ✓ pass | — | verified |
| SL-2 | validateCreateInput function | service-layer | service-layer/work-breakdown.md | src/service/validator.ts | ✅ | ✅ | tests/service/validator.test.ts | ✓ pass | AL-1:src/api/routes.ts | verified |
| SL-3 | Service layer integration tests | service-layer | service-layer/work-breakdown.md | tests/service/user-service.test.ts | ✅ | ✅ | self | ✓ pass | — | verified |

## Legend

- **Exists**: ✅ file present, ❌ missing
- **Impl**: ✅ all exports present, ⚠️ partial, ❌ missing, — file absent
- **Test Case**: test file path, `self` if row IS a test, ❌ if no direct test
- **Test Result**: ✓ pass, ✗ fail, — not yet run
- **Connected**: `{downstream-req}:{consumer-file}` via import
- **Status**: open → wip → fixed → verified

---

# Backward RTM: service-layer

| Test File | Test Description | Source File | Impl Function | Req ID | Design Ref | Traced |
|-----------|-----------------|-------------|---------------|--------|------------|--------|
| tests/service/user-service.test.ts | register + duplicate email | src/service/user-service.ts | register(), UserService | SL-1 | service-layer/work-breakdown.md | ✅ |
| tests/service/user-service.test.ts | getUser, updateUser, removeUser | src/service/user-service.ts | getUser(), updateUser(), removeUser() | SL-1 | service-layer/work-breakdown.md | ✅ |
| tests/service/user-service.test.ts | full lifecycle | src/service/user-service.ts | UserService | SL-3 | service-layer/work-breakdown.md | ✅ |

> **Note**: No test file traces back to SL-2 (validator.ts). `tests/service/validator.test.ts` does not exist.

---

# Bidirectional RTM: service-layer

| Req ID | Description | Has Code | Has Test | Test → Req Traced | Req → Test Traced | Gap |
|--------|-------------|----------|----------|-------------------|-------------------|-----|
| SL-1 | UserService + ServiceError | ✅ | ✅ | ✅ | ✅ | — |
| SL-2 | Validator (validateEmail, validateName, validateCreateInput) | ✅ | ❌ | — | ❌ | **test missing** |
| SL-3 | Service layer integration tests | ✅ (self) | ✅ (self) | ✅ | ✅ | — |

**Summary**:
- **1 gap detected**: SL-2 has implementation but **no direct test file** (`tests/service/validator.test.ts` missing)
- SL-2 done criteria explicitly require `tests/service/validator.test.ts` to exist and pass
- This is a T-1 violation if submitted as-is
