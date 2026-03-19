# consensus-loop Roadmap

> Tracks future improvements organized by priority and dependency.
> Items marked ✅ are implemented. Items marked 🔜 are next priority.

---

## ✅ Implemented (v2.3.0)

| Feature | Description |
|---------|-------------|
| Multi-agent orchestration | Orchestrator distributes to worktree-isolated implementers |
| Scout + 3-way RTM | Forward/Backward/Bidirectional traceability matrices |
| 6 MCP tools | code_map, dependency_graph, audit_scan, coverage_map, rtm_parse, rtm_merge |
| Coverage verification (CV) | CV-1~CV-3 done-criteria, coverage-gap rejection code |
| RTM-based evidence + audit | Per-row verification, per-row verdicts |
| Change impact analysis | Planner Phase 2.5 — dependency_graph "Imported By" classification |
| Risk management | Risk levels on rejection codes, pattern detection rules |
| Background agent spawning | run_in_background: true for all worker spawns |
| Interactive planner | 6-phase protocol: intent → research → impact → conflicts → draft → review |
| Audit history log | Persistent JSONL log + `audit_history` MCP tool with summary/filter/pattern detection |
| Scout gap report | Phase 7 gap report — unimplemented reqs, orphans, broken links → planner feedback |

---

## ✅ Audit History Log (infrastructure) — implemented

**Prerequisite for items 2-5 below.** Without persistent audit history, cross-session analysis is impossible.

### Design

Append-only JSON log at `REPO_ROOT/.claude/audit-history.jsonl`:

```jsonc
{
  "timestamp": "2026-03-19T15:30:00Z",
  "session_id": "s1",
  "track": "security-hardening",
  "req_ids": ["SH-1", "SH-2"],
  "verdict": "pending",
  "rejection_codes": [{ "code": "test-gap", "severity": "major", "risk": "medium", "file": "src/dashboard/service.ts", "line": 42 }],
  "round": 2,
  "agent_id": "a1b2c3",
  "duration_ms": 45000
}
```

### Enables

- Rejection pattern analysis across sessions
- Quality trend visualization over time
- Compound risk detection (same file rejected multiple rounds)
- Audit accuracy tracking (false positive/negative rates)

---

## Planned (ordered by dependency)

### 1. Scout → Planner Reverse Feedback

**Problem:** Scout discovers orphan tests, unimplemented requirements, broken cross-track links. This information dies after the RTM is generated — the planner never sees it.

**Solution:** After RTM generation, scout produces a **Gap Report** summarizing:
- Requirements without code → suggest adding to work-breakdown
- Orphan tests → suggest cleanup track or reassignment
- Broken cross-track links → suggest prerequisite adjustment in execution-order

Planner reads the gap report in Phase 2 (Research) and proposes work-breakdown amendments.

**Depends on:** RTM ✅, Planner interactive protocol ✅

### 2. ⚠️ Retrospective → Rejection Code Improvement Loop — protocol defined

**Problem:** Auditor issues false positives (rejects correct code) or false negatives (approves buggy code). Currently no mechanism to track or correct this.

**Solution:** During retrospective, record audit accuracy:
```markdown
### Audit Accuracy
- False positive: test-gap on SH-3 — test existed but auditor missed import chain
- False negative: none detected this round
```

Accumulate in audit-history.jsonl. When a rejection code has >30% false positive rate across 10+ rounds, flag for policy file review (rejection-codes.md or test-checklist.md).

**Depends on:** Audit history log 🔜, Retrospective protocol ✅

### 3. ⚠️ Upstream Delay → Downstream Auto-Notification — protocol defined

**Problem:** When parallel tracks execute, an upstream track's repeated rejection or timeout blocks downstream tracks. Currently the orchestrator discovers this only when it tries to spawn the downstream worker.

**Solution:** Orchestrator monitors active agents:
- If upstream agent receives 3+ rejections → auto-notify downstream as `blocked`
- If upstream audit exceeds TTL (30 min) → auto-notify downstream as `delayed`
- Update handoff status: `in-progress` → `blocked (upstream: PA-4 rejected 3x)`

**Depends on:** Audit history log 🔜, Background spawn ✅, Risk pattern detection ✅

### 4. ✅ Project-Level Rejection Pattern Dashboard — implemented

Implemented via `audit_history` MCP tool with `summary: true` mode. Provides:
- Rejection code frequency by track
- Approval rate trending
- Risk pattern detection (3+ same code → structural issue warning)
- Filter by track, code, since timestamp

The `/consensus-status` CLI command also surfaces current state.

### 5. Technical Debt Tracking

**Problem:** Retrospective discovers improvement opportunities, but they're stored in memory (ephemeral) not in work-catalog (actionable). Residual Risk in evidence is unstructured text.

**Solution:**
- Retrospective auto-appends discovered debt to `work-catalog.md` as `type: tech-debt`
- Scout includes tech-debt items in RTM gap analysis
- Orchestrator presents tech-debt items alongside regular work when selecting tasks
- Residual Risk in evidence format → structured: `{ file, description, priority, category }`

**Depends on:** Work-catalog ✅, Retrospective ✅, Scout RTM ✅

---

## Future Ideas

| Idea | Description |
|------|-------------|
| Performance verification (PF) | PF-1~PF-3 done-criteria: execution time, memory profile, regression benchmarks |
| Multi-model auditor ensemble | Multiple models review independently, consensus requires majority |
| Audit cost optimization | Track token usage per audit round, suggest evidence compression |
| Plugin marketplace analytics | Installation count, rejection pattern sharing across projects |
| Pre-submission self-check | Validate evidence against git diff before triggering external auditor |

---

## Dependency Graph

```
✅ Audit History Log (infra) — implemented
    ├─→ ⚠️ Rejection Code Improvement Loop (2) — protocol defined, needs structural enforcement
    ├─→ ⚠️ Upstream Delay Notification (3) — protocol defined, needs structural enforcement
    ├─→ ✅ Rejection Pattern Dashboard (4) — implemented (audit_history --summary)
    └─→ ⚠️ Technical Debt Tracking (5) — protocol defined, needs structural enforcement

✅ Scout → Planner Reverse Feedback (1) — implemented (Phase 7 Gap Report)
```
