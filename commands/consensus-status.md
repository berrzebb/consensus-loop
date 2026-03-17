---
name: consensus-status
description: Show current consensus-loop status — pending reviews, audit sessions, and feedback state
---

Check the current state of the consensus-loop feedback cycle.

## Steps

1. Read the watch file and respond file paths from config:

```bash
node -e "const c=JSON.parse(require('fs').readFileSync('${CLAUDE_PLUGIN_ROOT}/config.json','utf8'));const p=require('path'),r=require('child_process').execFileSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8'}).trim();console.log('watch='+p.resolve(r,c.consensus.watch_file));console.log('respond='+p.resolve(r,p.dirname(c.consensus.watch_file),c.plugin.respond_file||'gpt.md'))"
```

2. Read the watch file (evidence submissions):

```bash
cat "$(git rev-parse --show-toplevel)/$(node -e "console.log(JSON.parse(require('fs').readFileSync('${CLAUDE_PLUGIN_ROOT}/config.json','utf8')).consensus.watch_file)")" 2>/dev/null || echo "No watch file found"
```

3. Read the respond file (auditor verdicts):

```bash
node -e "const c=JSON.parse(require('fs').readFileSync('${CLAUDE_PLUGIN_ROOT}/config.json','utf8')),p=require('path'),r=require('child_process').execFileSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8'}).trim(),f=p.resolve(r,p.dirname(c.consensus.watch_file),c.plugin.respond_file||'gpt.md');try{console.log(require('fs').readFileSync(f,'utf8'))}catch{console.log('No respond file found')}"
```

4. Check for background audit lock:

```bash
cat ${CLAUDE_PLUGIN_ROOT}/audit.lock 2>/dev/null || echo "No audit in progress"
```

5. Check for active audit session:

```bash
cat ${CLAUDE_PLUGIN_ROOT}/session.id 2>/dev/null || echo "No active session"
```

6. Check for retrospective marker:

```bash
cat ${CLAUDE_PLUGIN_ROOT}/.session-state/retro-marker.json 2>/dev/null || echo "No retrospective pending"
```

7. Summarize the status to the user:
   - Number of trigger_tag, pending_tag, agree_tag items (tag names from config.json)
   - Whether a background audit is running (audit.lock)
   - Whether an audit session exists (with session ID)
   - Whether a retrospective review is pending
   - Last audit timestamp if available

> Note: Tag names are configurable in `${CLAUDE_PLUGIN_ROOT}/config.json`. Check `consensus.trigger_tag`, `consensus.agree_tag`, `consensus.pending_tag` for actual values.
