# Implementer Reference

## Scripts Quick Reference

Bundled at `${CLAUDE_PLUGIN_ROOT}/skills/implementer/scripts/`:

| Script | Usage | Purpose |
|--------|-------|---------|
| `audit-scan.mjs` | `node ... all` | Full codebase pattern scan (0 tokens) |
| `audit-scan.mjs` | `node ... type-safety` | `as any`, `@ts-ignore`, `console.log` |
| `audit-scan.mjs` | `node ... hardcoded` | Hardcoded strings, secrets, URLs |
| `add-locale-key.mjs` | `node ... "key" "ko" "en"` | Add key to ALL locale files at once |

## Done Criteria Categories

| Category | Key Checks | When |
|----------|-----------|------|
| CQ (Code Quality) | eslint per-file + tsc --noEmit | Before evidence |
| T (Test) | Execute test commands, verify direct tests | Before evidence |
| CC (Claim-Code) | git diff --name-only matches Changed Files | Before evidence |
| CL (Cross-Layer) | BE→FE contracts documented | Before evidence |
| S (Security) | Input validation, auth guards | Before evidence |
| I (i18n) | Locale keys in ALL locale files | Before evidence |

Full criteria: `${CLAUDE_PLUGIN_ROOT}/templates/references/${locale}/done-criteria.md`

## Commit Rules

- WIP commit only after `[agree_tag]`: `WIP(scope): short summary`
- Never use feat/fix/refactor during implementation — those are for squash merge
- Retrospective and squash merge are **orchestrator's responsibility**
