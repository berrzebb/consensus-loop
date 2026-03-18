# Planner Reference

## Output Location

Read planning directories from config:
```bash
node -e "console.log(JSON.parse(require('fs').readFileSync('${CLAUDE_PLUGIN_ROOT}/config.json','utf8')).consensus.planning_dirs)"
```

## Work Breakdown Template

See example: [examples/work-breakdown.example.md](examples/work-breakdown.example.md)

## Rules

1. Cross-layer contracts — every WB item specifies BE/FE requirements as pairs
2. Dependency chain — every `requires` field references specific WB IDs
3. No vague goals — "improve X" is not a goal. "Reduce Y to < Z" is.
4. ko/en both — produce documents in both locales
5. Check infra-layer-gaps.md before planning (hidden dependencies)

## Execution Order Update Procedure

When adding or adjusting tracks in `execution-order.md`:

1. Read current execution-order.md → understand full dependency graph
2. Identify insertion point based on prerequisites
3. Update the table row (순서, 도메인, 선행 조건, 완료 기준)
4. If ordering changed → verify all downstream tracks still have their prerequisites met
5. Update "즉시 착수 추천 묶음" if the new/changed track is parallelizable

## Work Catalog Sync Procedure

When WB items are added/modified/removed in `work-breakdown.md`:

1. Read current work-catalog.md
2. Find the corresponding domain section
3. Add/update/remove rows to match work-breakdown.md WB items
4. Each row must include: ID, 작업, Type, Model, Risk
5. Verify "권장 실행 순서" section consistency

## Adjusting Existing Tracks

When called to modify (not create) a track:

1. Read current README.md → check if Problem/Goal/Exit Condition need update
2. Read current work-breakdown.md → identify which WB items need change
3. Make targeted changes — do not rewrite documents that are already correct
4. Check downstream tracks that depend on this track → flag if broken
5. Update execution-order.md and work-catalog.md to reflect changes
