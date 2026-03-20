# Correction Cycle

On `[pending_tag]` rejection — **send correction to existing agent via SendMessage**.

## Procedure

1. Look up `agent_id` for the task in handoff
2. Read rejection codes + rationale from respond file
3. Compose correction prompt:
   ```
   SendMessage(to: "<agent_id>") {
     ## Correction Round: [task-id]
     ### Rejection Codes: ...
     ### Instructions: ...
   }
   ```
4. Update handoff status: `auditing` → `correcting`
5. Agent fixes and resubmits → re-enters audit loop

## Decision Matrix

| Rejection Type | Action |
|----------------|--------|
| CQ (lint/type) | SendMessage — same agent, minor fix |
| T (test failure) | SendMessage — same agent |
| CC (mismatch) | SendMessage — same agent, rewrite evidence |
| security/regression | Escalate to user — high risk |
| 3+ repeated rejections | Escalate to user — approach needs rethinking |

## When SendMessage Fails

If the agent has terminated or is unresponsive:
1. Spawn a new implementer via Agent tool (worktree isolation)
2. Include previous rejection codes + existing worktree reference path
3. Update `agent_id` in handoff

## Upstream Delay Notification

When parallel tracks are active, monitor for upstream delays:

1. **After each correction round**: query `audit_history` for the current track
2. **If 3+ rejections on same track**: auto-update downstream tasks as `blocked (upstream: [task-id] rejected 3x)`
3. **If audit TTL exceeded (30 min)**: mark downstream as `delayed`
4. **Present to user** (interactive) or **auto-block** (headless): downstream tasks are blocked until upstream resolves

### Headless Behavior

In headless mode, the orchestrator cannot ask the user "escalate or continue?" Instead:
- 3+ rejections → auto-block downstream + log reason in handoff
- Security/regression → mark task as `blocked (needs human review)` + stop spawning
- Never prompt — always take the safe default action
