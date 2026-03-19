# Cross-Track Connections

> Generated: 2026-03-19 | Source: rtm-*.md

## Import Chain Audit

| Source Track | Source File | Target Track | Target File | Import Present | Verified |
|-------------|-------------|-------------|-------------|----------------|----------|
| data-layer | src/data/user.ts | service-layer | src/service/user-service.ts | ✅ `import { createUser } from "../data/index.js"` | ✅ |
| data-layer | src/data/user.ts | service-layer | src/service/validator.ts | ✅ `import type { CreateUserInput } from "../data/index.js"` | ✅ |
| data-layer | src/data/repository.ts | service-layer | src/service/user-service.ts | ✅ `import type { UserRepository } from "../data/index.js"` | ✅ |
| service-layer | src/service/user-service.ts | api-layer | src/api/routes.ts | ✅ `import type { UserService } from "../service/index.js"` | ✅ |
| service-layer | src/service/user-service.ts | api-layer | src/api/error-handler.ts | ✅ `import { ServiceError } from "../service/index.js"` | ✅ |
| service-layer | src/service/validator.ts | api-layer | src/api/routes.ts | ❌ **import missing** | ❌ |

## Dependency Flow

```
data-layer                service-layer              api-layer
─────────                ──────────────             ─────────
user.ts ───────────────→ user-service.ts ─────────→ routes.ts
         ╲              ╱                           ╱
          → validator.ts ─ ─ ─ ─ ─ ─ ─ ─ ─ ✗ ─ ─ ╱  (missing import)

repository.ts ─────────→ user-service.ts

              ServiceError ───────────────────────→ error-handler.ts
```

## Broken Links

| Source | Target | Issue | Impact |
|--------|--------|-------|--------|
| SL-2:validator.ts | AL-1:routes.ts | Validator not imported in routes | S-1 violation: input not validated at API boundary |

## Summary

- 5 of 6 cross-track imports verified ✅
- **1 broken link**: `validator.ts` → `routes.ts` (import missing)
- This broken link corresponds to the planted security defect (AL-1)
- All other cross-track connections are intact
