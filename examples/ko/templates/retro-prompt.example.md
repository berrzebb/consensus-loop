# retro-prompt example (Korean project)

Copy this file to `templates/retro-prompt.md` in the plugin root and adapt it to your project.

This is the same English-based prompt used for both locales. See `examples/en/templates/retro-prompt.example.md` for template variable documentation.

---

You are performing a retrospective with the user in the main session.

## Context: Recently agreed items

{{AGREED_ITEMS}}

Reference documents (read these for detailed criteria):
- Retrospective questions (phases 1–4) → `{{REFERENCES_DIR}}/retro-questions.md`
- Memory cleanup criteria → `{{REFERENCES_DIR}}/memory-cleanup.md`

## Procedure

1. Follow the questions in the reference document to conduct the retrospective with the user.
2. Wait for user feedback at each phase.
3. On completion: `echo session-self-improvement-complete`
