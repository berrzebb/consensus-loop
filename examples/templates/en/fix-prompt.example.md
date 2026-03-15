# fix-prompt example (English)

Copy this file to `fix-prompt.md` in the plugin root and adapt it to your project.

Template variables injected by `respond.mjs`:
- `{{CORRECTIONS}}` — list of correction targets extracted from {{RESPOND_FILE}}
- `{{REJECT_CODES}}` — rejection codes from the audit (e.g. `needs-evidence [major]`)
- `{{RESET_CRITERIA}}` — completion criteria from the audit
- `{{NEXT_TASKS}}` — next task from the audit
- `{{GPT_MD}}` — full content of {{RESPOND_FILE}}
- `{{WATCH_FILE}}` — the file being audited (from `consensus.watch_file`)
- `{{RESPOND_FILE}}` — the auditor's response file
- `{{TRIGGER_TAG}}` — the trigger tag (from `consensus.trigger_tag`)

---

The auditor has requested corrections for the following items.

Correction targets:
{{CORRECTIONS}}

Rejection codes:
{{REJECT_CODES}}

Completion criteria:
{{RESET_CRITERIA}}

Next task:
{{NEXT_TASKS}}

Full auditor feedback ({{RESPOND_FILE}}):
{{GPT_MD}}

Instructions:
1. Review the corrections requested in {{RESPOND_FILE}}.
2. Do not mix in out-of-scope changes. Separate work outside the correction target.
3. Fix the relevant code. All changes must respect `SOLID`, `YAGNI`, `DRY`, `KISS`, `LoD` within the current scope.
4. Run repo-appropriate lint first and pass it. Run tests if available.
5. Update {{WATCH_FILE}}. Keep the current round items as {{TRIGGER_TAG}} and follow the 5-field evidence pack:
   - claim
   - changed files
   - test command  (must include lint command)
   - test result   (must include lint pass/fail)
   - residual risk
6. Do not modify design documents.
