# retro-questions example (English)

Copy this file to `templates/references/en/retro-questions.md` and adapt it to your project.

Questions used in retrospective after audit cycle completion.
- Add/modify questions to match your team's retrospective culture
- Memory cleanup criteria reference `memory-cleanup.md`

---

# Retrospective Questions

> Questions used in retrospective after audit cycle completion. Add/modify to fit your team.

## ① What went well

- What design/implementation worked effectively?
- What was effective in auditor-implementer collaboration?
- Are there reusable patterns or principles?

## ② What was problematic

- What required repeated corrections?
- What was inefficient or unclear?
- What was the root cause of rejections/pending items?

## ③ Memory cleanup

- Detailed criteria → `references/{{LOCALE}}/memory-cleanup.md`
- Identify duplicate/stale memory files → clean up
- Memory derivable from code → delete
- Newly learned principles → record in memory

## ④ Bidirectional feedback

- AI → User: Honest feedback on collaboration style
- User → AI: Areas for improvement

## Caution

- **Do not modify code directly** — suggest improvements only
- **Do not proceed without user confirmation** — wait for feedback at each step
