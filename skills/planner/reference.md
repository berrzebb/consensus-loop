# Planner Reference

## Output Location

Read planning directories from config:
```bash
node -e "console.log(JSON.parse(require('fs').readFileSync('${CLAUDE_SKILL_DIR}/../../config.json','utf8')).consensus.planning_dirs)"
```

## Work Breakdown Template

See example: [examples/work-breakdown.example.md](examples/work-breakdown.example.md)

## Rules

1. Cross-layer contracts — every WB item specifies BE/FE requirements as pairs
2. Dependency chain — every `requires` field references specific WB IDs
3. No vague goals — "improve X" is not a goal. "Reduce Y to < Z" is.
4. ko/en both — produce documents in both locales
5. Check infra-layer-gaps.md before planning (hidden dependencies)
