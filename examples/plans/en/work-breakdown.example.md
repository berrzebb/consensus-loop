# Work Breakdown: Audit Protocol — Consensus Loop

## Working Principles

- the plugin must remain self-contained: no state outside its directory
- config.json is the single customization point — code must not require modification to change tags or paths
- quality rules and consensus loop are part of the same protocol, not separate concerns
- Linux and Windows must both work without env-specific branches in config
- session continuity (resume vs new) is controlled by `session.id`, not by the caller

## Recommended Sequence

1. `CL-1` Core consensus loop (trigger → audit → agree)
2. `CL-2` Auto-sync on pending response detection
3. `CL-3` Quality rules integration (ESLint, npm audit)
4. `CL-4` Planning-doc sync (gpt-only normalize pass)
5. `CL-5` Config extraction + Linux/Windows compatibility
6. `CL-6` plans/ documentation structure

## CL-1 Core Consensus Loop

- Goal:
  - watch_file edit + trigger_tag → audit_script → agree_tag detection
- Prerequisite:
  - none
- First touch files:
  - `.claude/hooks/consensus-loop/index.mjs`
  - `.claude/hooks/consensus-loop/audit.mjs`
  - `.claude/hooks/consensus-loop/config.json`

## CL-2 Auto-Sync on Pending Response

- Goal:
  - any file edit → check if respond file is newer than watch file → run respond_script
- Prerequisite:
  - CL-1
- First touch files:
  - `.claude/hooks/consensus-loop/index.mjs`
  - `.claude/hooks/consensus-loop/respond.mjs`

## CL-3 Quality Rules Integration

- Goal:
  - quality_rules in config → match edited file → run inline check command → print errors
- Prerequisite:
  - CL-1
- First touch files:
  - `.claude/hooks/consensus-loop/index.mjs`
  - `.claude/hooks/consensus-loop/config.json`

## CL-4 Planning-Doc Sync

- Goal:
  - edits to planning_files → gpt-only normalize pass via respond_script --gpt-only
- Prerequisite:
  - CL-2
- First touch files:
  - `.claude/hooks/consensus-loop/index.mjs`
  - `.claude/hooks/consensus-loop/config.json`

## CL-5 Config Extraction + Compatibility

- Goal:
  - all tags, paths, rules extracted to config.json; cli-runner.mjs handles Windows + Linux binary resolution
- Prerequisite:
  - CL-1, CL-3
- First touch files:
  - `.claude/hooks/consensus-loop/config.json`
  - `.claude/hooks/consensus-loop/cli-runner.mjs`

## CL-6 Plans Documentation Structure

- Goal:
  - plans/en/ + plans/ko/ README and work-breakdown mirroring docs/en/design/improved/ format
- Prerequisite:
  - CL-1 through CL-5
- First touch files:
  - `.claude/hooks/consensus-loop/plans/en/README.md`
  - `.claude/hooks/consensus-loop/plans/en/work-breakdown.md`
  - `.claude/hooks/consensus-loop/plans/ko/README.md`
  - `.claude/hooks/consensus-loop/plans/ko/work-breakdown.md`
