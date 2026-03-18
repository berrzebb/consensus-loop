# consensus-loop

Claude Code hook 플러그인 — GPT/Codex 감사 기반 태그 합의 프로토콜. 코드 편집마다 자동 감사 → 합의 → 회고 → 커밋 사이클 실행.

## Quick Commands

```bash
# 테스트 실행
node --test tests/              # 전체 테스트
node --test tests/cl1-verify.test.mjs  # 단일 파일

# 드라이런 (감사 실행 없이 훅 로직만 검증)
FEEDBACK_HOOK_DRY_RUN=1 node index.mjs

# 플러그인 캐시 초기화 (소스 수정 후)
rm -rf ~/.claude/plugins/cache/consensus-loop
```

## 핵심 모듈 맵

```
index.mjs          ← PostToolUse 진입점: watch_file 감지 → 감사 트리거
  ├→ context.mjs   ← 공유 컨텍스트: config, 경로, 파서, i18n (단일 소스)
  ├→ audit.mjs     ← 백그라운드 감사 실행 (Codex/GPT 호출, detached spawn)
  ├→ respond.mjs   ← gpt.md ↔ claude.md 태그 동기화 (promote/demote)
  └→ retrospective.mjs ← 합의 후 회고 마커 설정

session-gate.mjs   ← PreToolUse: 회고 완료 전 Bash/Agent 차단
session-start.mjs  ← SessionStart: 핸드오프 동기화 + 컨텍스트 주입
session-stop.mjs   ← Stop: 핸드오프 동기화 + 자동 커밋
subagent-stop.mjs  ← SubagentStop: 워커 완료 감지 + 지연 회고

cli-runner.mjs     ← 크로스 플랫폼 바이너리 탐색 (codex/claude)
handoff-writer.mjs ← 저장소 ↔ Claude 메모리 핸드오프 양방향 동기화
i18n.mjs           ← 독립 로케일 헬퍼 (context.mjs 미사용 환경용)
```

## config.json

위치: `consensus-loop/config.json` (gitignored, 프로젝트별 설정)

핵심 필드:
- `plugin.locale` — `"ko"` 또는 `"en"` (허용 목록 외 값은 `"en"` 폴백)
- `consensus.watch_file` — 증거 파일 경로 (저장소 루트 기준, 예: `docs/feedback/claude.md`)
- `consensus.trigger_tag` / `agree_tag` / `pending_tag` — 상태 전이 태그
- `quality_rules[]` — 파일 편집 시 자동 실행되는 품질 검사 (ESLint, tsc 등)

예제: `examples/config.example.json`

### Hook Toggles

`plugin.hooks_enabled`로 개별 훅을 비활성화할 수 있다 (기본값: 모두 `true`):

```json
{
  "plugin": {
    "hooks_enabled": {
      "audit": true,          // 감사 트리거 (PostToolUse)
      "session_gate": true,   // 회고 강제 게이트 (PreToolUse)
      "quality_rules": true,  // 파일별 품질 검사 (PostToolUse)
      "pre_compact": true     // 압축 전 상태 스냅샷 (PreCompact)
    }
  }
}
```

## Gotcha

- **audit.lock** — `REPO_ROOT/.claude/audit.lock`에 PID + TTL로 동시 감사 방지. TTL 만료 또는 PID 사망 시 자동 해제. 수동 삭제 전 `audit-bg.log` 확인 필수.
- **Reentrance guard** — `FEEDBACK_LOOP_ACTIVE=1` 환경변수로 자식 프로세스의 재진입 방지. 훅이 감사 스크립트를 호출하고, 감사 스크립트가 파일을 수정하면 훅이 다시 트리거되는 무한 루프를 차단.
- **Debounce** — 연속 편집은 10초 디바운스. `REPO_ROOT/.claude/audit-debounce.ts` 타임스탬프로 관리. 마지막 편집만 감사 트리거.
- **Worktree 인식** — `context.mjs`의 `resolveRepoRoot()`는 cwd 기반 `git rev-parse` 우선. 워크트리 내 서브에이전트는 워크트리 루트를 사용, 메인 저장소가 아님.
- **Fail-open** — session-gate 오류 시 통과 허용 (시스템 잠금 방지). 감사 실패도 마찬가지.
- **PreCompact 스냅샷** — `/compact` 실행 전에 `REPO_ROOT/.claude/compaction-snapshot.json`에 감사 상태(retro-marker, audit.lock, 마지막 항목)를 저장. SessionStart에서 자동 복원.
- **Context Reinforcement** — SessionStart마다 AI-GUIDE.md의 "절대 규칙" 섹션을 `<CONTEXT-REINFORCEMENT>` 태그로 자동 재주입. 컨텍스트 압축 후에도 핵심 프로토콜 규칙이 유지됨.

## 코드 패턴

- **Facade 프롬프트**: `templates/*.md`는 ~30줄 facade → `templates/references/{locale}/` 정책 파일 참조. `{{REFERENCES_DIR}}` 런타임 치환.
- **i18n**: `locales/{ko,en}.json` + `context.mjs`의 `t()` 함수. `plugin.locale` 설정값 사용.
- **context.mjs 단일 소스**: 모든 스크립트가 config, 경로, 태그 상수를 `context.mjs`에서 import. 중복 파싱 없음.
- **Policy as Data**: 감사 기준 변경 시 코드 수정 불필요 → `references/ko/*.md` 편집만으로 반영.

## Resume (자동 재개)

세션이 중단된 후 다시 시작하면 `session-start.mjs`가 아래 상태를 자동 감지하고 구체적인 재개 지시를 제공한다:

| 감지 조건 | 재개 지시 |
|-----------|-----------|
| audit.lock 존재 + PID 사망 | 락 자동 정리 → 증거 재제출 안내 |
| gpt.md에 `[pending_tag]` | 반려 코드 추출 → 보정 후 재제출 안내 |
| watch_file에 `[trigger_tag]` + 감사 결과 없음 | 감사 미실행/실패 → 재제출 안내 |
| retro-marker `retro_pending` | 회고 미완료 → 프로토콜 안내 |
| retro-marker `deferred_to_orchestrator` | 서브에이전트 회고 위임 → orchestrator 회고 안내 |
| handoff에 "진행 중" 작업 | 미완료 트랙 → orchestrator 재개 안내 |
| compaction-snapshot 존재 | 압축 전 상태 복원 |

## 테스트

- 위치: `tests/` (Node.js 내장 테스트 러너)
- 헬퍼: `tests/_helpers.mjs` — 공통 모킹/유틸
- 환경변수: `FEEDBACK_HOOK_DRY_RUN=1`로 외부 의존성 없이 로직 검증
