---
name: consensus-loop:status
description: "Show current consensus-loop status — pending reviews, audit state, retro marker, agent assignments. Use to check what's happening before starting work or after returning from a break."
---

# Consensus Loop Status

Check the current state of the feedback cycle.

## Checks

1. **Config**:
```bash
node -e "const c=JSON.parse(require('fs').readFileSync('${CLAUDE_PLUGIN_ROOT}/config.json','utf8'));console.log('watch_file:',c.consensus.watch_file);console.log('trigger:',c.consensus.trigger_tag);console.log('agree:',c.consensus.agree_tag);console.log('pending:',c.consensus.pending_tag)"
```

2. **Audit lock**:
```bash
cat "$(git rev-parse --show-toplevel)/.claude/audit.lock" 2>/dev/null || echo "No audit running"
```

3. **Retro marker**:
```bash
cat ${CLAUDE_PLUGIN_ROOT}/.session-state/retro-marker.json 2>/dev/null || echo "No retro pending"
```

4. **Session handoff** (if exists):
```bash
head -30 "$(git rev-parse --show-toplevel)/.claude/session-handoff.md" 2>/dev/null || echo "No handoff"
```

## Output

Summarize:
- Tag counts (trigger/pending/agree items in watch file)
- Audit status (running/idle, last timestamp)
- Retro status (pending/complete)
- Active agents (from handoff: in-progress tasks with agent_id)
