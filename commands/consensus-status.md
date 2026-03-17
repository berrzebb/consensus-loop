---
name: consensus-status
description: Show current consensus-loop status — pending reviews, audit sessions, and feedback state
---

Check the current state of the consensus-loop feedback cycle.

## Steps

1. Read the watch file (feedback/claude.md) from the plugin directory:

```bash
cat ${CLAUDE_PLUGIN_ROOT}/feedback/claude.md 2>/dev/null || echo "No watch file found"
```

2. Read the respond file (gpt.md):

```bash
cat ${CLAUDE_PLUGIN_ROOT}/gpt.md 2>/dev/null || echo "No respond file found"
```

3. Check for active audit session:

```bash
cat ${CLAUDE_PLUGIN_ROOT}/session.id 2>/dev/null || echo "No active session"
```

4. Check for retrospective marker:

```bash
cat ${CLAUDE_PLUGIN_ROOT}/.session-state/retro-marker.json 2>/dev/null || echo "No retrospective pending"
```

5. Summarize the status to the user:
   - Number of [REVIEW_NEEDED], [CHANGES_REQUESTED], [APPROVED] items
   - Whether an audit session is active (with session ID)
   - Whether a retrospective review is pending
   - Last audit timestamp if available
