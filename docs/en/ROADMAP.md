# consensus-loop Roadmap

> Status: idea backlog — not planned for implementation yet.

## Multi-Track Parallel Audits

### Rules

1. **Track isolation** — each track gets independent `audit-{id}.lock` and `session-{id}.id`. gpt.md is shared but write-locked at file level.
2. **No changed-file overlap** — if two tracks modify the same file, they run sequentially. Overlap detected at evidence submission time.
3. **Respect dependencies** — `depends_on` in handoff blocks audit start until the upstream track reaches `agree_tag`.
4. **Concurrency limit** — max 2 parallel audits (API rate limit + resource constraint).
5. **Independent commits** — each track commits independently after consensus. One track's rejection doesn't block another.
6. **Merged retrospective** — if multiple tracks reach consensus within 5 minutes, retrospective is combined into one.

### Future Ideas

- **Audit history log** — append-only record of all verdicts for pattern analysis
- **Pre-submission self-check** — validate evidence against git diff before triggering Codex
- **Rejection pattern warning** — warn if the same rejection code appears 3+ times across tracks
