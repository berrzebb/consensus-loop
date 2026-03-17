# Verify Implementation Reference

Full done-criteria: read `${CLAUDE_SKILL_DIR}/../../templates/references/en/done-criteria.md`

## Quick Reference

| ID | Category | Check | Tool |
|----|----------|-------|------|
| CQ-1 | Code Quality | `npx eslint <file>` per changed file | Bash |
| CQ-2 | Code Quality | `npx tsc --noEmit` | Bash |
| CQ-4 | Code Quality | `node ${CLAUDE_SKILL_DIR}/scripts/audit-scan.mjs type-safety` | Bash |
| T-1 | Test | Execute evidence test commands verbatim | Bash |
| T-2 | Test | Grep for test importing changed module | Grep |
| T-3 | Test | `npx vitest run <related>` | Bash |
| CC-2 | Claim-Code | `git diff --name-only` vs Changed Files | Bash |
| S-1 | Security | Check validator for new input paths | Grep |
| I-1 | i18n | Check locale keys not hardcoded | Grep |
| I-2 | i18n | Both ko.json and en.json contain key | Read |
| FV-1 | Frontend | `agent-browser snapshot` — page loads | Bash |
| FV-4 | Frontend | `agent-browser console` — no errors | Bash |
