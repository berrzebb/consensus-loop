# Work Breakdown: data-layer

## Working Principles

- Each item independently committable
- Done criteria = code + lint + tests only
- In-memory storage (no external DB dependency)

## Recommended Sequence

1. DL-1 User entity type
2. DL-2 UserRepository (depends on DL-1)
3. DL-3 Data layer tests (depends on DL-2)

---

## DL-1 User Entity Type

- **Goal**: Define the core User type and factory function
- **Prerequisites**: none
- **First Touch Files**:
  - `src/data/user.ts`
- **Implementation**:
  - `User` interface: `id`, `name`, `email`, `createdAt`, `updatedAt`
  - `CreateUserInput` type: omit `id`, `createdAt`, `updatedAt`
  - `createUser(input: CreateUserInput): User` factory — generates UUID, sets timestamps
- **Tests**:
  - Factory produces valid User with all fields
  - Each call generates unique `id`
  - `createdAt` and `updatedAt` are equal on creation
- **Done Criteria**:
  - `npx eslint src/data/user.ts` passes
  - `npx tsc --noEmit` passes
  - Related tests pass

---

## DL-2 UserRepository

- **Goal**: Define repository interface and in-memory implementation
- **Prerequisites**: DL-1
- **First Touch Files**:
  - `src/data/repository.ts`
- **Implementation**:
  - `UserRepository` interface: `findById`, `findAll`, `save`, `update`, `delete`
  - `InMemoryUserRepository` class implementing the interface
  - Store as `Map<string, User>`
  - `save()` rejects duplicate `id`
  - `update()` sets `updatedAt` to current time
  - `delete()` returns `boolean` (found or not)
- **Tests**:
  - CRUD happy path (save → findById → update → delete)
  - `save()` duplicate throws
  - `findAll()` returns all stored users
  - `delete()` non-existent returns `false`
  - `update()` non-existent throws
- **Done Criteria**:
  - `npx eslint src/data/repository.ts` passes
  - `npx tsc --noEmit` passes
  - Related tests pass

---

## DL-3 Data Layer Integration Tests

- **Goal**: Verify data layer works as a cohesive unit
- **Prerequisites**: DL-2
- **First Touch Files**:
  - `tests/data/repository.test.ts`
- **Implementation**:
  - Test file imports `createUser`, `InMemoryUserRepository`
  - Tests full lifecycle: create → save → find → update → find → delete → find (null)
  - Tests concurrent operations (multiple users)
  - Tests edge cases (empty repo, findAll on empty)
- **Tests**:
  - Full lifecycle (create → CRUD → verify)
  - Multiple users coexist
  - Empty repository behavior
- **Done Criteria**:
  - `npx eslint tests/data/repository.test.ts` passes
  - `npx vitest run tests/data/repository.test.ts` passes
  - No regressions in DL-1, DL-2 tests
