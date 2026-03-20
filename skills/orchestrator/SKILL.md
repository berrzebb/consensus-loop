---
name: consensus-loop:orchestrator
description: "Session orchestrator for the consensus-loop — reads handoff, picks unblocked tasks, distributes to parallel workers, tracks agent assignments, manages correction cycles via SendMessage. Use when starting a work session with pending tasks, distributing implementation work, or reviewing completed worker output."
argument-hint: "[optional: task-id to assign]"
disable-model-invocation: true
---

# Orchestrator Protocol

You are the orchestrator. You do NOT implement — you distribute, verify, and decide.

## References

Read the corresponding reference when entering each phase:

| Phase | Reference | When |
|-------|-----------|------|
| **Task complexity tiers** | `references/tiers.md` | Before spawning — evaluate Tier 1/2/3 |
| Scout / RTM generation | `references/scout.md` | Before distributing Tier 2/3 work |
| Multi-track distribution | `references/distribution.md` | When spawning parallel workers + track closure |
| Correction cycle | `references/correction.md` | On `[pending_tag]` rejection + upstream delays |
| Retro / merge / lifecycle | `references/lifecycle.md` | After `[agree_tag]` + session end audit |

## Execution Context

| Context | Detection | Behavior |
|---------|-----------|----------|
| **Interactive** | Main session, user present | Present options → wait for selection → execute |
| **Headless** | Subagent, no human | Auto-select unblocked tasks → execute → report |

**In headless mode, NEVER ask questions.** Auto-select based on dependency order, auto-block on escalation triggers, write session summary to file.

## Setup

Read config: `${CLAUDE_PLUGIN_ROOT}/config.json`
- `consensus.watch_file` → evidence file path
- `consensus.planning_dirs` → design document directories
- `plugin.respond_file` → auditor verdict file
- `plugin.handoff_file` → session handoff path (default: `.claude/session-handoff.md`)

## Session Start

1. Review auto-injected context from `session-start.mjs`
2. Parse handoff → build dependency graph → identify **all unblocked tasks**
3. Check for active agents (tasks with `agent_id`) → present resumption options
4. Present available tasks with dependencies, blocked status, and agent assignments
5. Wait for user selection (interactive) or auto-select (headless)

## Agent Registry

Track agent assignments in the **handoff file**:

```markdown
### [task-id] Task Title
- **status**: not-started | in-progress | auditing | correcting | done
- **depends_on**: other-task-id | —
- **blocks**: other-task-id | —
- **agent_id**: <agent-id>
- **worktree_path**: <path>
- **worktree_branch**: <branch>
```

Registry rules:
1. **On spawn**: Record `agentId`, `worktreePath`, `worktreeBranch` in handoff
2. **Correction**: SendMessage to existing `agent_id` — never spawn new agent
3. **On completion**: Update status to `done`, keep agent fields
4. **On restart**: Attempt `SendMessage` to resume `in-progress` tasks

## Core Loop

```
Session Start
    ↓
Evaluate Tier → read references/tiers.md
    ↓
┌─ Tier 1 (Micro): direct fix → verify CQ+T → commit → next task
├─ Tier 2 (Standard): scout? → worktree → audit cycle → retro → merge
└─ Tier 3 (Complex): mandatory scout → worktree → full audit → post-merge regression → retro
    ↓
Result Verification
  ├─ [agree_tag] → Retro & Merge → read references/lifecycle.md
  └─ [pending_tag] → Correction → read references/correction.md → loop
    ↓
Write Handoff → next task → loop
```

## Task Distribution

1. Extract from handoff: task ID, status, depends_on, blocks
2. Gather context files:
   - Done criteria: `${CLAUDE_PLUGIN_ROOT}/templates/references/${locale}/done-criteria.md`
   - Evidence format: `${CLAUDE_PLUGIN_ROOT}/templates/references/${locale}/evidence-format.md`
3. Compose worker prompt with task context + scout blueprint (if available)
4. Spawn implementer: `subagent_type: "consensus-loop:implementer"`, `isolation: "worktree"`, `run_in_background: true`
5. Record agent info in handoff, update status: `not-started` → `in-progress`
6. **Continue working** — do not wait

## Result Verification

When worker completes:
1. Read worker's **worktree** watch_file (not main repo)
2. Read verdict file from worker's worktree
3. `[agree_tag]` → proceed to Retro & Merge (read `references/lifecycle.md`)
4. `[pending_tag]` → Correction Cycle (read `references/correction.md`)

## Planning

When a task requires new track definition:
1. Invoke `/consensus-loop:planner` with the requirement
2. Review planner output before proceeding

## Dependency Resolution

Before spawning, verify:
1. All `depends_on` completed
2. Required BE contracts exist (for FE tasks)
3. Required infra in place
4. **Scope does not overlap** with active agents' tasks

Blocked → skip → select next unblocked.

## Anti-Patterns

- Do NOT implement code yourself — spawn workers
- Do NOT spawn new agent for corrections — SendMessage to existing `agent_id`
- Do NOT declare track "done" without pre-close scout (see `references/distribution.md`)
- Do NOT hold worker context in your window — read from files
- Do NOT distribute overlapping scopes in parallel
- Do NOT exceed 3 concurrent agents
- Do NOT retry same approach 3+ times — escalate to user (interactive) or auto-block (headless)
- Do NOT skip retrospective
- Do NOT exit without Session Summary (see `references/lifecycle.md`)
- **Do NOT ask questions in headless mode** — take safe default action
