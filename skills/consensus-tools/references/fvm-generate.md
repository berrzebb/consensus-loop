# fvm_generate

Static analysis tool that cross-references FE routes, API calls, BE endpoints, and access policies to produce a Functional Verification Matrix (FVM).

## When to Use

- Security audit — verify that access policies match actual endpoint behavior
- New feature verification — generate expected auth matrix for new routes
- FE↔BE gap detection — find API calls without matching endpoints (or vice versa)
- Pre-deployment check — ensure all routes have proper access control defined

## Parameters

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `--path` | Yes | — | Project root directory (must contain `web/src/` and `src/dashboard/`) |
| `--format` | No | `full` | `full` (all sections), `mismatches` (FE/BE gaps only), `matrix` (verification rows only) |

## Examples

```bash
# Full FVM with summary, mismatches, and matrix
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs fvm_generate --path /path/to/project

# Only FE↔BE mismatches
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs fvm_generate --path /path/to/project --format mismatches

# Raw verification matrix only
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs fvm_generate --path /path/to/project --format matrix

# JSON output with structured data
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs fvm_generate --path /path/to/project --json
```

## What It Analyzes

1. **FE Routes**: `web/src/router-paths.ts` — path constants
2. **Access Policies**: `web/src/pages/access-policy.ts` — view/manage tiers per route
3. **Route → Page Mapping**: `web/src/router.tsx` — which component handles each route
4. **FE API Calls**: All `api.get/post/put/patch/del()` calls in `web/src/`
5. **BE Endpoints**: JSDoc headers in `src/dashboard/routes/*.ts`
6. **Cross-reference**: FE calls ↔ BE endpoints → find gaps

## Access Tiers

| Tier | Roles Allowed |
|------|--------------|
| `public` | All (including unauthenticated) |
| `authenticated` | superadmin, owner, manager, member, viewer |
| `team_member` | superadmin, owner, manager, member, viewer |
| `team_manager` | superadmin, owner, manager |
| `team_owner` | superadmin, owner |
| `superadmin` | superadmin only |

GET requests use the `view` tier; mutations (POST/PUT/PATCH/DELETE) use the `manage` tier.

## Output Format (full)

```
## FVM — Functional Verification Matrix

### Summary
- FE Routes: 25
- FE API Calls: 48
- BE Endpoints: 52
- FVM Rows: 762
- Mismatches: 4

### Mismatches
| Type | FE | BE | Files |
|------|----|----|-------|

### Verification Matrix
| Route | Page | Feature | API Endpoint | Method | Tier | Role | Expected |
|-------|------|---------|-------------|--------|------|------|----------|
```

## Mismatch Types

| Type | Meaning |
|------|---------|
| FE-only | FE calls an API that has no BE endpoint |
| BE-only | BE defines an endpoint that no FE code calls |
