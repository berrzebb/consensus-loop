# Work Breakdown: service-layer

## Working Principles

- Depends on data-layer (imports User, UserRepository)
- Business logic separated from persistence
- Validation is a distinct concern (separate module)

## Recommended Sequence

1. SL-1 UserService (depends on DL-2)
2. SL-2 Validator (depends on SL-1)
3. SL-3 Service layer tests (depends on SL-2)

---

## SL-1 UserService

- **Goal**: Implement business logic layer for user operations
- **Prerequisites**: DL-2
- **First Touch Files**:
  - `src/service/user-service.ts`
- **Implementation**:
  - `UserService` class: constructor takes `UserRepository`
  - `register(input: CreateUserInput): User` — validate → save → return
  - `getUser(id: string): User | null` — findById
  - `listUsers(): User[]` — findAll
  - `updateUser(id: string, updates: Partial<CreateUserInput>): User` — merge → update
  - `removeUser(id: string): boolean` — delete
  - Throw `ServiceError` with code for business rule violations
- **Tests**:
  - `register()` creates and persists user
  - `register()` with duplicate email throws `ServiceError("DUPLICATE_EMAIL")`
  - `getUser()` returns null for missing user
  - `updateUser()` merges partial fields
  - `removeUser()` returns false for missing user
- **Done Criteria**:
  - `npx eslint src/service/user-service.ts` passes
  - `npx tsc --noEmit` passes
  - Related tests pass

---

## SL-2 Validator

> **[PLANTED DEFECT: test-gap]** — This WB intentionally has no direct test file.
> The implementer must create `tests/service/validator.test.ts`, but the planted
> defect scenario omits it. Auditor should catch T-1 violation.

- **Goal**: Input validation logic for user operations
- **Prerequisites**: SL-1
- **First Touch Files**:
  - `src/service/validator.ts`
- **Implementation**:
  - `validateEmail(email: string): boolean` — RFC 5322 basic check
  - `validateName(name: string): boolean` — length 1-100, no special chars
  - `validateCreateInput(input: CreateUserInput): ValidationResult` — aggregate
  - `ValidationResult` type: `{ valid: boolean; errors: string[] }`
- **Tests**:
  - Valid email formats accepted
  - Invalid email formats rejected (missing @, no domain, etc.)
  - Name length boundaries (0, 1, 100, 101)
  - Aggregate validation collects all errors
- **Done Criteria**:
  - `npx eslint src/service/validator.ts` passes
  - `npx tsc --noEmit` passes
  - **Direct test file `tests/service/validator.test.ts` must exist and pass**

---

## SL-3 Service Layer Integration Tests

- **Goal**: Verify service layer with real repository
- **Prerequisites**: SL-2
- **First Touch Files**:
  - `tests/service/user-service.test.ts`
- **Implementation**:
  - Test file imports `UserService`, `InMemoryUserRepository`, `createUser`
  - Tests business logic with real (in-memory) persistence
  - Tests validation integration (invalid input → rejection)
  - Tests error propagation (ServiceError codes)
- **Tests**:
  - Register → get → update → list → remove lifecycle
  - Duplicate email detection
  - Invalid input rejected before persistence
  - ServiceError contains correct code
- **Done Criteria**:
  - `npx eslint tests/service/user-service.test.ts` passes
  - `npx vitest run tests/service/user-service.test.ts` passes
  - No regressions
