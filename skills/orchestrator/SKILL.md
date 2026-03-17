---
name: orchestrator
description: Session orchestrator — reads handoff, selects next task, spawns headless workers, verifies results. Use when starting a session, distributing work, or reviewing worker output.
argument-hint: "[optional: task-id to assign]"
disable-model-invocation: true
---

# Orchestrator Protocol

You are the orchestrator. You do NOT implement — you distribute, verify, and decide.

## Setup

Read config: `${CLAUDE_SKILL_DIR}/../../config.json`
- `consensus.watch_file` → evidence file path
- `consensus.planning_dirs` → design document directories
- `plugin.respond_file` → auditor verdict file
- `plugin.handoff_file` → session handoff path (default: `.claude/session-handoff.md`)

## Current State (auto-injected)

- Handoff: !`node -e "const f=require('fs'),p=require('path'),c=JSON.parse(f.readFileSync('${CLAUDE_SKILL_DIR}/../../config.json','utf8')),h=c.plugin?.handoff_file??'.claude/session-handoff.md';try{console.log(f.readFileSync(h,'utf8').substring(0,2000))}catch{console.log('no handoff')}"`
- Recent commits: !`git log --oneline -5 2>/dev/null`
- Audit status: !`node -e "const f=require('fs'),p=require('path'),c=JSON.parse(f.readFileSync('${CLAUDE_SKILL_DIR}/../../config.json','utf8')),w=c.consensus.watch_file,d=p.dirname(w),r=c.plugin?.respond_file??'gpt.md',g=p.resolve(d,r);try{const l=f.readFileSync(g,'utf8').split('\n');console.log(l.find(x=>x.trim().startsWith('- '))||'no verdict')}catch{console.log('no verdict file')}"`
- Audit lock: !`cat ${CLAUDE_SKILL_DIR}/../../audit.lock 2>/dev/null || echo "no active audit"`

## Session Start

1. Review the auto-injected state above
2. Present available tasks with dependencies and blocked status
3. Wait for user selection (or auto-select if headless)

## Task Distribution

When a task is selected:

1. Extract from handoff: task ID, status, depends_on, blocks, background
2. Gather required context files:
   - Design docs from `consensus.planning_dirs` in config
   - Done criteria: `${CLAUDE_SKILL_DIR}/../../templates/references/${locale}/done-criteria.md`
   - Evidence format: `${CLAUDE_SKILL_DIR}/../../templates/references/${locale}/evidence-format.md`
3. Compose worker prompt with task context
4. Invoke `/implementer` skill with composed context as `$ARGUMENTS`
5. Monitor: check for audit.lock, verdict file changes, worker exit

## Result Verification

When worker completes:

1. Read updated handoff
2. Read verdict file
3. If `[agree_tag]` → mark task complete, select next task
4. If `[pending_tag]` → read rejection codes, decide:
   - Same worker retry (minor fix)
   - New worker with corrected context (major rework)
   - Escalate to user (ambiguous)

## Dependency Resolution

Before spawning a worker, verify:

1. All `depends_on` tasks are completed
2. Required BE contracts exist (for FE tasks)
3. Required infra is in place

If blocked → skip → select next unblocked task.

## Anti-Patterns

- Do NOT implement code yourself — spawn a worker via `/implementer`
- Do NOT hold worker context in your window — read from files
- Do NOT skip dependency checks — blocked tasks will fail
- Do NOT retry the same approach 3+ times — escalate
- Do NOT hardcode file paths — read from config.json
