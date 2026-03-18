# Implementer Reference

## Done Criteria Summary

Before submitting evidence, verify ALL items:

| Category | Criteria | How to verify |
|----------|---------|---------------|
| CQ-1 | Per-file eslint pass | `npx eslint <file>` for each changed file |
| CQ-2 | Type check pass | `npx tsc --noEmit` |
| T-1 | Evidence test commands pass | Copy-paste and run |
| T-2 | Direct tests exist for each claim | Test file:line reference |
| CC-1 | Claim matches code | Read changed files |
| CC-2 | Changed Files = git diff | `git diff --name-only` |
| S-1 | New inputs validated | Check validator exists |
| S-2 | New API has auth guard | Check guard file:line |
| I-1 | Locale keys used | No hardcoded strings |
| I-2 | ALL locales have key | Check ko.json + en.json |

Full details: `${CLAUDE_PLUGIN_ROOT}/templates/references/en/done-criteria.md`

## Evidence Format

```markdown
## [trigger_tag] Task Title

### Claim
What was done — specific, verifiable.

### Changed Files
- `path/to/file.ts` — what changed

### Test Command
npx vitest run tests/specific.test.ts

### Test Result
(paste actual terminal output)

### Residual Risk
Known unresolved items.
```

## Commit Rules

- WIP commit only after `[agree_tag]`: `WIP(scope): short summary`
- Never use feat/fix/refactor during implementation
- Retrospective and squash merge are **orchestrator's responsibility** — not yours
- Orchestrator runs `/merge-worktree` to create the final structured commit

## Scripts Available

Run from skill directory:

```bash
# Code pattern scan (0 tokens, replaces grep)
node ${CLAUDE_PLUGIN_ROOT}/skills/implementer/scripts/audit-scan.mjs all

# Add locale key to ko + en at once
node ${CLAUDE_PLUGIN_ROOT}/skills/implementer/scripts/add-locale-key.mjs "key" "ko_value" "en_value"
```
