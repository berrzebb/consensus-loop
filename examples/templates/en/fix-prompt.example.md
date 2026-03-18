# fix-prompt example (English)

Copy this file to `templates/fix-prompt.md` in the plugin root and adapt it to your project.

Template variables injected by `respond.mjs`:
- `{{CORRECTIONS}}` — list of correction targets extracted from auditor response
- `{{REJECT_CODES}}` — rejection codes from the audit (e.g. `needs-evidence [major]`)
- `{{RESET_CRITERIA}}` — completion criteria from the audit
- `{{NEXT_TASKS}}` — next task from the audit
- `{{GPT_MD}}` — full content of auditor response file
- `{{CLAUDE_MD_PATH}}` — the file being audited (from `consensus.watch_file`)
- `{{GPT_MD_PATH}}` — the auditor's response file
- `{{TRIGGER_TAG}}` — the trigger tag (from `consensus.trigger_tag`)
- `{{DESIGN_DOCS_DIR}}` — glob pattern for design documents (read-only)
- `{{REFERENCES_DIR}}` — absolute path to `templates/references/{locale}/` (already includes locale)

---

The GPT auditor has requested corrections on the following items.
Correction targets:
{{CORRECTIONS}}
Rejection codes:
{{REJECT_CODES}}
Completion criteria reset:
{{RESET_CRITERIA}}
Next tasks:
{{NEXT_TASKS}}
GPT feedback original ({{GPT_MD_PATH}}):
{{GPT_MD}}
Reference documents (read these for detailed rules):
- Correction rules (scope, verification, order) → `{{REFERENCES_DIR}}/fix-rules.md`
- Evidence package format → `{{REFERENCES_DIR}}/evidence-format.md`
- Code quality & security principles → `{{REFERENCES_DIR}}/principles.md`
- Rejection code definitions → `{{REFERENCES_DIR}}/rejection-codes.md`
Tasks:
1. Review the correction requests in {{GPT_MD_PATH}}.
2. Fix the code following the rules in the reference documents. Only make minimal adjustments to preserve original intent when instructions directly conflict. Do not perform broad rewrites.
3. Update {{CLAUDE_MD_PATH}} (keep {{TRIGGER_TAG}}). Use the fixed output/update format: `Correction targets` → `Rejection codes` → `Completion criteria reset` → `Next tasks`. Include all four section titles and fields — do not omit, add, or reorder. Prioritize already-listed issues, and only concretize vague terms/thresholds/criteria with specific numbers/conditions/verdict criteria. Keep other wording as-is. If no listed issues exist, concretize at most 1 item following the above principle.
4. Do NOT modify design documents (`{{DESIGN_DOCS_DIR}}`).
