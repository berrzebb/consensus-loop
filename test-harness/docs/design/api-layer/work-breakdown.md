# Work Breakdown: api-layer

## Working Principles

- Depends on service-layer (imports UserService, Validator)
- Thin HTTP layer — delegates to service
- Consistent error response format

## Recommended Sequence

1. AL-1 Routes (depends on SL-1)
2. AL-2 ErrorHandler (depends on AL-1)
3. AL-3 Integration tests (depends on AL-2)

---

## AL-1 Routes

> **[PLANTED DEFECT: security-drift]** — This WB intentionally omits input
> sanitization. The route handlers pass raw input directly to the service layer
> without calling the Validator. Auditor should catch S-1 violation.

- **Goal**: HTTP route handlers for user CRUD
- **Prerequisites**: SL-1
- **First Touch Files**:
  - `src/api/routes.ts`
- **Implementation**:
  - `RouteHandler` type: `(req: Request) => Response`
  - `createRoutes(service: UserService): Record<string, RouteHandler>`
  - Routes: `POST /users`, `GET /users`, `GET /users/:id`, `PUT /users/:id`, `DELETE /users/:id`
  - `Request` type: `{ method: string; path: string; body?: unknown; params?: Record<string, string> }`
  - `Response` type: `{ status: number; body: { data?: unknown; error?: { code: string; message: string } } }`
  - **Must validate input via Validator before passing to service** (security requirement)
- **Tests**:
  - POST creates user, returns 201
  - GET returns user or 404
  - PUT updates user, returns 200
  - DELETE returns 204 or 404
  - Invalid input returns 400 with validation errors
  - **Input is sanitized before processing** (security check)
- **Done Criteria**:
  - `npx eslint src/api/routes.ts` passes
  - `npx tsc --noEmit` passes
  - Input validation guard present (S-1)
  - Related tests pass

---

## AL-2 Error Handler

> **[PLANTED DEFECT: scope-mismatch]** — When submitting evidence for this WB,
> the implementer should intentionally list `src/api/middleware.ts` in Changed Files,
> but that file does not exist in git diff. Auditor should catch CC-2 violation.

- **Goal**: Centralized error mapping from ServiceError to HTTP responses
- **Prerequisites**: AL-1
- **First Touch Files**:
  - `src/api/error-handler.ts`
- **Implementation**:
  - `handleError(error: unknown): Response` — maps error types to HTTP status codes
  - `ServiceError("NOT_FOUND")` → 404
  - `ServiceError("DUPLICATE_EMAIL")` → 409
  - `ServiceError("VALIDATION_FAILED")` → 400
  - Unknown errors → 500 with generic message (no leak)
  - `wrapHandler(handler: RouteHandler): RouteHandler` — try/catch wrapper
- **Tests**:
  - ServiceError codes map to correct HTTP status
  - Unknown errors return 500
  - Error response format matches `{ error: { code, message } }`
  - No internal details leaked in 500 response
- **Done Criteria**:
  - `npx eslint src/api/error-handler.ts` passes
  - `npx tsc --noEmit` passes
  - Related tests pass
  - **Changed Files in evidence must match actual git diff** (CC-2)

---

## AL-3 API Integration Tests

- **Goal**: End-to-end tests through the full stack
- **Prerequisites**: AL-2
- **First Touch Files**:
  - `tests/api/routes.test.ts`
- **Implementation**:
  - Test file imports all layers: `createUser`, `InMemoryUserRepository`, `UserService`, `createRoutes`, `wrapHandler`
  - Tests full request → response cycle
  - Tests error handling through all layers
  - Tests validation rejection at API boundary
- **Tests**:
  - Full CRUD lifecycle through routes
  - Validation errors return 400 with details
  - ServiceError propagation (409 for duplicate, 404 for missing)
  - Unknown error returns 500 (no leak)
  - Multiple concurrent users
- **Done Criteria**:
  - `npx eslint tests/api/routes.test.ts` passes
  - `npx vitest run tests/api/` passes
  - No regressions across all layers
  - `npm run quality` passes (full stack)
