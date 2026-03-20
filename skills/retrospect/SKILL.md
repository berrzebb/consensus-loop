---
name: consensus-loop:retrospect
description: "Extract learnings from audit history and conversation, manage memories, clean up stale entries. Use after completing a track, during retrospective (③ memory step), at end of session, or anytime the user wants memory maintenance. Triggers on 'what did we learn', 'memory cleanup', 'review learnings', 'retrospective', 'update memories', '회고', '메모리 정리'."
argument-hint: "[track name or 'all']"
---

# Retrospect Protocol

Mine the current session for learnings and translate them into durable memories. Sessions generate massive amounts of information — your job is to find the fraction worth remembering, structure it properly, and persist it.

## Mode Selection

| Signal | Mode | Phases | When |
|--------|------|--------|------|
| Casual question ("뭘 배웠지?", "learnings") | **Quick** | 1a → 3 → 6 | Simple summary, end-of-session |
| Maintenance request ("메모리 정리", "cleanup") | **Full** | 1~6 all | Memory audit, bulk operations |
| Track argument ("/retrospect OR") | **Full** | 1~6 all | Deep track analysis |
| During retrospective (③ step) | **Full** | 1~6 all | Post-audit protocol |

Mode is selected automatically — do not ask the user.

## Execution Context

| Context | Detection | Approval Behavior |
|---------|-----------|-------------------|
| **Interactive** | Main session, user is responding | Present candidates → wait for approval → execute |
| **Headless** | Subagent, no human to respond | Auto-approve threshold-met candidates → defer ambiguous → execute → report |

**In headless mode, NEVER ask questions or wait for input.** Any prompt will block indefinitely. Auto-approve what meets threshold rules, defer the rest as `⏭️ deferred to orchestrator`.

## Setup

Read config: `${CLAUDE_PLUGIN_ROOT}/config.json` → `plugin.locale`

Locate memory: use `Glob` to find `**/memory/MEMORY.md`. Read it to understand existing memories (avoid duplicates, check line count < 200).

## Phases

### Phase 1: Gather Sources

Read `references/gathering.md` for detailed source collection methods.

**Quick mode**: conversation + git log only (skip audit_history).
**Full mode**: conversation + audit_history + git log.

### Phase 2: Deduplicate (Full mode only)

Read existing memory files → build topic index → mark candidates as "new" or "update".

### Phase 3: Generate Candidates

Read `references/candidates.md` for memory format template, categories, and threshold rules.

4 categories: **feedback** (corrections + confirmations), **project** (work context), **user** (role/preferences), **reference** (external pointers).

### Phase 4-6: Present → Execute → Verify

Read `references/execution.md` for presentation format, approval flow, and integrity checks.

- Interactive: present table → wait for approval
- Headless: auto-approve → execute → report with deferred items

## Integration with Retrospective

When invoked during post-audit retrospective (③ Memory cleanup step):
- This skill handles memory extraction and cleanup
- Other retro steps (① what went well, ② problems, ④ feedback, ⑤ Act) continue independently
- Learnings needing code changes → work-catalog items (not memories)

## Memory Authority

Only **this skill and agents** may read/write memories. Other skills (verify, merge, planner) must not access the memory directory directly. This prevents memory pollution from non-learning contexts.

| Actor | Memory Access |
|-------|-------------|
| `consensus-loop:retrospect` | Read + Write (primary owner) |
| Agents (orchestrator, implementer) | Read only (via auto-memory system) |
| Other skills (verify, merge, planner) | **No access** — request via orchestrator if needed |

## Rules

1. **Data before candidates** — gather all sources before generating
2. **Deduplicate before presenting** — check existing memories first (Full mode)
3. **Every candidate cites a source** — no unsupported claims
4. **User approves everything** (interactive) / **auto-approve with thresholds** (headless)
5. **Why + How to apply** required for feedback/project types
6. **Prefer update over create** — one good memory > two overlapping
7. **Show what you skipped** — user may disagree with threshold
8. **Verify after execution** — MEMORY.md integrity check (Full mode)
9. **Never block in headless mode** — no questions, no prompts, no "should I?"
10. **Memory authority** — only this skill writes memories; other skills must not touch memory files
