---
name: merge-worktree
description: Squash-merge the current worktree branch into the target branch with a structured commit message. Use after verify-implementation passes and audit reaches consensus.
argument-hint: "[target-branch]"
disable-model-invocation: true
context: fork
allowed-tools: Read, Grep, Glob, Bash(git *)
---

# Merge Worktree

Squash-merge the current worktree branch back into the target branch. All WIP commits become one structured commit.

## Who Runs This

This skill is invoked by the **orchestrator** after:
1. Implementer's `[agree_tag]` consensus reached
2. Implementer's WIP commit completed
3. **Retrospective protocol completed** (session-gate released via `session-self-improvement-complete`)

Do NOT run this skill if retrospective is still pending — `session-gate.mjs` will block git commands.

## Current Context

- Git dir: `!git rev-parse --git-dir`
- Current branch: `!git branch --show-current`
- Recent commits: `!git log --oneline -20`
- Working tree status: `!git status --short`

## Instructions

Follow phases in order. Do NOT skip phases.

---

### Phase 1: Validation

1. **Verify worktree**: `git rev-parse --git-dir` must contain `/worktrees/`. If not → stop:
   > "This skill must be run from inside a git worktree."

2. **Identify current branch**: `git branch --show-current`

3. **Resolve target branch**:
   - If `$ARGUMENTS` provided → use as target
   - Otherwise → detect `main` or `master`

4. **Find original repo**: `git rev-parse --git-common-dir` → derive original repo root

5. **Clean working tree**: `git status --porcelain` must be empty. If not → stop:
   > "Uncommitted changes found. Commit or stash first."

---

### Phase 2: Research

1. **Commit history**: `git log --oneline <target>..HEAD`

2. **File change summary**: `git diff <target>...HEAD --stat`

3. **Full diff**: `git diff <target>...HEAD` — read carefully

4. **Read key files**: For significantly changed files, use Read to understand full context

5. **Categorize changes**:
   - Features (new functionality)
   - Fixes (bug corrections)
   - Refactors (code restructuring)
   - Tests (new or updated)
   - Docs (documentation)
   - Chore (build, CI, tooling)

---

### Phase 3: Generate Commit Message

Structure:

```
<type>(<scope>): <summary under 72 chars>

<body — what changed and why, grouped by category>

<footer — breaking changes, issue refs, co-authors>
```

**Type rules**:
- `feat` — new functionality
- `fix` — bug correction
- `refactor` — restructuring without behavior change
- `test` — test additions/changes only
- `docs` — documentation only
- `chore` — build, CI, tooling

**Scope**: the primary module affected (e.g., `bus`, `security`, `orchestration`, `fe`)

**Body guidelines**:
- Group changes by category with `###` headers if multiple types
- Reference file paths for significant changes
- Explain WHY, not just WHAT
- Include test results summary

**Footer**:
```
Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

### Phase 4: Execute Merge

1. **Switch to original repo**:
   ```bash
   cd <original_repo_root>
   ```

2. **Squash merge**:
   ```bash
   git merge --squash <worktree_branch>
   ```

3. **Commit with generated message**:
   ```bash
   git commit -m "<generated_message>"
   ```

4. **Report result**:
   ```markdown
   ## Merge Complete

   - Branch: <worktree_branch> → <target_branch>
   - Commits squashed: N
   - Files changed: M
   - Commit: <short_sha> <first_line>

   The worktree branch is now merged. You can remove the worktree with:
   ```bash
   git worktree remove <worktree_path>
   ```
   ```

---

### Phase 5: Cleanup (optional)

Ask the user:

```markdown
**Worktree merged successfully. Clean up?**

1. **Remove worktree** — delete the worktree directory and branch
2. **Keep worktree** — leave for reference
```

If remove:
```bash
git worktree remove <worktree_path>
git branch -d <worktree_branch>
```

---

## Commit Message Examples

### Single feature:
```
feat(bus): add event replay port for SSE reconnection

EventBus now supports replay_since(cursor, { team_id }) for
tenant-scoped event replay. InMemory uses ring buffer,
Redis uses XRANGE.

- src/bus/types.ts: ReplayableMessageBus interface
- src/bus/service.ts: ring buffer implementation (max 1000)
- src/bus/redis-bus.ts: XRANGE-based replay
- tests/bus/replay.test.ts: 12 tests

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

### Mixed changes:
```
feat(fe): unified input bar + tool choice mode

### Features
- ChatPromptBar redesign: [+] [Tool Choice] [Tools N] [@] [Model] [Send]
- MentionPicker: 3-column search (Agents | Tools | Workflows)
- ToolChoiceToggle: Auto/Manual/None with ⌘P shortcut

### Fixes
- G-2: team switch query invalidation (cross-tenant leakage)

### Tests
- 15 new component tests, all passing

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

## Exceptions

- Do NOT merge if `git status --porcelain` shows uncommitted changes
- Do NOT force-push after merge
- Do NOT delete the worktree without user confirmation
- Do NOT merge if verify-implementation has unresolved failures
