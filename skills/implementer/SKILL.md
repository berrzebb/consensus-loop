---
name: consensus-loop:implementer
description: Headless worker — receives task + context, implements code, runs tests, submits evidence, handles audit corrections. Spawned by orchestrator, not invoked directly by users.
argument-hint: "<task description or handoff section>"
user-invocable: false
context: fork
model: claude-sonnet-4-6
allowed-tools: Read, Edit, Write, Grep, Glob, Bash(npx *), Bash(node *), Bash(git diff *), Bash(git status *), Bash(git log *), Bash(git add *), Bash(git commit *), Bash(cat *), Bash(ls *)
---

# Implementer

> **This skill has been superseded by `agents/implementer.md`.** The orchestrator should spawn workers via the Agent tool (`isolation: "worktree"`, `subagent_type: "consensus-loop:implementer"`).

The `scripts/` directory in this folder is shared with the agent:

| Script | Purpose |
|--------|---------|
| `scripts/audit-scan.mjs` | Code pattern scan (type-safety, hardcoded, etc.) |
| `scripts/add-locale-key.mjs` | Add locale key to all locale files at once |
