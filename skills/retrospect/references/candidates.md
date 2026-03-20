# Phase 2-3: Deduplication + Candidate Generation

## Phase 2: Deduplicate Against Existing Memories

**Before generating candidates**, read every existing memory file and build a topic index:

```
existing_topics:
  - "권한 설정: defaultMode + allow" (feedback_permission_settings.md)
  - "에이전트 진단 신뢰" (feedback_trust_agent_diagnosis.md)
  - "세션 핸드오프 상태" (project_session_handoff.md)
```

For each potential candidate from Phase 1:
1. Check if an existing memory covers the **same topic**
2. If yes → mark as **update** (not create)
3. If no → mark as **new**

This prevents memory bloat — the #1 failure mode of memory systems.

**Quick mode**: skip this phase. Present duplicates for user to decide (or auto-skip in headless mode).

## Phase 3: Generate Candidates

### Memory Format Template

Every memory file must follow this structure:

```markdown
---
name: {descriptive_snake_case}
description: {one-line — used for relevance matching in future sessions}
type: {user | feedback | project | reference}
---

{Content body}

**Why:** {the reason this matters — often a past incident or strong preference}

**How to apply:** {when/where this guidance kicks in}
```

The **Why** and **How to apply** fields are required for `feedback` and `project` types. They provide context for future sessions to judge edge cases instead of blindly following rules.

### Candidate Categories

**feedback** — How to approach work (corrections + confirmations)
> Rule: "Always inject data, never instruct the auditor to run commands"
> Why: CC-2 loop repeated 6 times because auditor ignored text instructions
> How to apply: In audit.mjs, use {{PRE_VERIFIED}} to inject results directly

**project** — Ongoing work context not derivable from code
> Fact: "DT track requires cloud GPU — local testing limited to CPU mode"
> Why: GCP Vertex AI pipeline dependency
> How to apply: CI tests use CPU mode with quality tolerance; staging uses GPU

**user** — User's role, expertise, preferences
> "User has deep Go expertise, new to React and this project's frontend"
> Why: Frame frontend explanations in terms of backend analogues
> How to apply: When explaining React concepts, relate to Go patterns the user already knows

**reference** — Pointers to external information
> "Pipeline bugs are tracked in Linear project INGEST"
> Why: Need to check Linear when debugging pipeline issues
> How to apply: Query Linear INGEST project for context on pipeline-related tickets

### What NOT to Save

- Code patterns derivable from reading the codebase
- Git history obtainable via `git log`
- Information already in CLAUDE.md
- Ephemeral task details (current progress, temp state)
- Debugging solutions (the fix is in the code; the commit message has context)
