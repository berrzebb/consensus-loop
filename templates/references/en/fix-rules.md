# Fix Rules

> Rules applied when correcting after GPT auditor rejection. Adjust to fit your team's policy.

## Scope Rules

- **No scope expansion** beyond correction targets — separate out-of-scope work
- Only modify items in current audit track
- Do not merge other track items into `{{TRIGGER_TAG}}` section

## Code Modification Rules

- Modifications must respect design principles within current scope
- Detailed principles → `references/{{LOCALE}}/principles.md`

## Verification Order

1. **Lint first** — run per-file checks from `quality_rules.presets` in `.claude/quorum/config.json`
2. **Tests** — Run existing tests + add new tests as needed
3. **Type check** — run project-wide checks from `quality_rules.presets` (skip if no matching preset)

## Evidence Submission

- Detailed format → `references/{{LOCALE}}/evidence-format.md`
- Replace `{{CLAUDE_MD_PATH}}` entirely via Write tool
- Do not modify design docs
