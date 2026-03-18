# consensus-loop AI 에이전트 가이드

> 이 문서는 consensus-loop 훅이 설치된 프로젝트에서 작업하는 **AI 에이전트(Claude)**를 위한 가이드입니다.

## 역할 체인

consensus-loop는 4개 역할이 순환하는 멀티 에이전트 프로토콜입니다:

| 역할 | 책임 | 격리 |
|------|------|------|
| **planner** | 트랙 정의 + 실행계획(work-breakdown) 조정 | fork (Opus) |
| **orchestrator** | execution-order에서 WB 선택 → implementer 분배 → 회고 → squash merge → 핸드오프 | 메인 세션 |
| **implementer** | worktree에서 구현 + 테스트 + 증거 제출 + WIP 커밋 | worktree (Sonnet) |
| **auditor** | 증거 독립 검증 → 합의/반려 판정 | 별도 프로세스 (GPT/Codex) |

> **참고**: implementer의 정규 사양은 `agents/implementer.md`입니다. `consensus-loop:implementer` 스킬은 레거시 진입점입니다.

## 전체 사이클

```
planner ─── 트랙 정의 + 실행계획 조정
    ↓
orchestrator ─── execution-order에서 WB 선택 → 스코프 검증 → 병렬 분배
    ↓                                         (파일 중복 없는 트랙만)
┌─── Track A (worktree) ──────┐  ┌─── Track B (worktree) ──────┐
│  implementer: 구현 + 테스트   │  │  implementer: 구현 + 테스트   │
│  → consensus-loop:verify     │  │  → consensus-loop:verify     │
│    (CQ/T/CC/CL/S/I/FV)      │  │    (CQ/T/CC/CL/S/I/FV)      │
│  → 증거 제출                  │  │  → 증거 제출                  │
│  → 감사 (비동기)              │  │  → 감사 (비동기)              │
│  [pending_tag] → SendMessage │  │  [agree_tag] → WIP 커밋      │
│  → 보정 → 재제출              │  │                               │
│  [agree_tag] → WIP 커밋      │  │                               │
└──────────────────────────────┘  └──────────────────────────────┘
    ↓ (모든 트랙: agree_tag + WIP 커밋)
회고 프로토콜 (session-gate 차단)
    → 잘된 것 / 문제인 것 / 메모리 갱신
    → "session-self-improvement-complete" → 게이트 해제
    ↓
orchestrator: /consensus-loop:merge → squash merge → 단일 커밋
    ↓
orchestrator: 세션 핸드오프 작성 → 다음 WB 선택 → 반복
```

## 증거 패키지 형식

watch_file (보통 `docs/feedback/claude.md`)에 **Write (전체 교체)**로 작성합니다:

```markdown
## [trigger_tag] 작업 제목

### Claim
무엇을 했는지 구체적으로 서술. 단, claim에 포함되지 않은 변경은 diff에서도 없어야 합니다.

### Changed Files

**Code**
- `src/path/to/file.ts` — 변경 내용 설명

**Tests**
- `tests/path/to/file.test.ts` — 테스트 추가/수정 설명

### Test Command
```bash
npx vitest run tests/specific-file.test.ts
npx eslint src/path/to/file.ts
npx tsc --noEmit
```

### Test Result
```
실제 터미널 출력을 그대로 복사-붙여넣기합니다.
요약 금지 — 감사자가 검증할 수 있는 원본 출력이어야 합니다.
```

### Residual Risk
닫지 못한 항목. 공격자가 악용 가능한 것은 Residual Risk가 아니라 수정 대상입니다.
알려진 미해결 사항이 없으면 "없음"으로 기재합니다.
```

## 절대 규칙

1. **태그는 `[trigger_tag]`만 사용** — `[완료]`, `[부분 완료]` 등 비표준 태그 금지. 감사자가 판정하면 `[agree_tag]` 또는 `[pending_tag]`를 사용합니다.
2. **자기 승격 금지** — 당신이 `[agree_tag]`를 직접 붙일 수 없습니다. 감사자만 승격합니다.
3. **Test Command는 재실행 가능해야 함** — 감사자가 그대로 복사해서 실행합니다. glob 패턴 금지.
4. **변경 파일 각각 eslint 통과 필수** — 하나라도 실패하면 감사가 반려됩니다.
5. **설계 문서 수정 금지** — `docs/` 하위 설계 문서는 읽기 전용입니다.
6. **증거는 정확히 1개 섹션** — 한 번에 여러 증거를 동시에 제출하지 않습니다.
7. **Changed Files는 실제 diff와 일치** — claim 범위 밖의 파일이 diff에 있으면 `scope-mismatch`로 반려됩니다.

## 검증 시퀀스 (consensus-loop:verify)

증거 제출 전에 **반드시** `/consensus-loop:verify`를 실행하세요. 7개 카테고리를 순차 검증합니다:

| # | 카테고리 | 코드 | 검증 내용 | 통과 조건 |
|---|----------|------|-----------|-----------|
| 1 | Code Quality | CQ-1~CQ-4 | 파일별 eslint + tsc + 금지 패턴 | 모든 변경 파일 lint/tsc 통과 |
| 2 | Test | T-1~T-4 | 테스트 실행 + claim별 직접 테스트 존재 + 회귀 없음 | 증거의 테스트 커맨드 통과 |
| 3 | Claim-Code Consistency | CC-1~CC-3 | claim과 코드 동작 일치 + 파일 목록이 diff와 일치 | claim ↔ diff 불일치 없음 |
| 4 | Cross-Layer Contract | CL-1~CL-3 | BE→FE 문서화 + 새 인터페이스에 소비자 존재 | 계층 간 계약 추적 가능 |
| 5 | Security | S-1~S-3 | 새 입력 검증 + 엔드포인트 인증 + 민감 데이터 미노출 | OWASP 위반 없음 |
| 6 | i18n | I-1~I-2 | 사용자 문자열 로케일 키 사용 + 모든 로케일에 키 존재 | 하드코딩 문자열 없음 |
| 7 | Frontend Verification | FV-1~FV-5 | 페이지 로드 + DOM 요소 + 콘솔 에러 없음 + 빌드 성공 | FE 변경 시에만 실행 |

출력: 카테고리별 PASS/FAIL 통합 테이블. **모두 PASS여야 제출 가능**.

## 반려 코드

감사자가 사용하는 반려 코드 전체 목록:

| 코드 | 심각도 | 의미 | 트리거 |
|------|--------|------|--------|
| `needs-evidence` | major/minor | 증거 패키지 누락 또는 부실 | 핵심 claim 미지원 / 부분 격차 |
| `scope-mismatch` | **major** | claim과 코드 범위 불일치 | diff의 파일이 증거에 없거나 그 반대 |
| `lint-gap` | **major** | lint 실패 | CQ-1/CQ-2 실패. `file:L{line}` + 에러 메시지 필수 |
| `test-gap` | **major** | 테스트 부족 | T-1 실패 또는 T-2 미충족 (직접 테스트 없음) |
| `claim-drift` | **minor** | 증거 서술과 코드 동작 불일치 | CC-1 실패 (증거에는 X라 했지만 코드는 Y) |
| `principle-drift` | major/minor | SOLID/YAGNI/DRY/KISS/LoD 위반 | 구조적 회귀 / 경미한 원칙 위반 |
| `security-drift` | **critical** | OWASP TOP 10 위반 | S-1/S-2/S-3 실패. 공격 시나리오 포함 필수 |

## 비동기 감사 동작

증거를 제출하면(watch_file에 `[trigger_tag]` 포함하여 저장):

1. PostToolUse 훅이 감사를 **백그라운드**에서 시작합니다 (연속 편집 시 10초 디바운스 적용)
2. 훅은 즉시 반환되므로 **다른 작업을 계속**하세요
3. `.claude/audit.lock` 파일이 존재하면 감사가 진행 중입니다 (repo `.claude/` 디렉토리에 생성)
4. **CronCreate로 3분 간격 감시 태스크를 등록**하세요:
   - `.claude/audit.lock` 존재 여부 확인
   - `node ${CLAUDE_PLUGIN_ROOT}/respond.mjs` 실행 (멱등, 플러그인 모드) 또는 `node .claude/hooks/consensus-loop/respond.mjs` (레거시)
   - 결과가 있으면 사용자에게 보고
5. 감사가 완료되면 `audit.lock`이 삭제되고 결과가 자동 동기화됩니다

## [pending_tag] 보정 사이클

감사자가 반려하면 `respond.mjs`가 보정 항목을 전달합니다.

### 보정 절차 (단일 에이전트)
1. 반려 코드의 `구체 지점`(file:line)을 확인
2. 코드를 수정
3. 동일한 증거 패키지를 갱신하여 다시 제출 (`[trigger_tag]` 유지)

### 보정 절차 (멀티 에이전트 — orchestrator → implementer)

orchestrator는 보정 시 **새 에이전트를 스폰하지 않습니다**. 기존 에이전트의 `agent_id`에 `SendMessage`로 보정 지시를 전달합니다:

- **major 반려** (test-gap, scope-mismatch, lint-gap) → SendMessage로 구체 보정 지시
- **minor 반려** (claim-drift) → SendMessage로 증거 서술 갱신 지시
- **critical 반려** (security-drift) → orchestrator가 직접 개입하여 수정

보정 완료 후 implementer가 증거를 재제출하면 감사가 다시 시작됩니다.

## Session Gate & 회고 프로토콜

### Session Gate 동작

`session-gate.mjs` (PreToolUse 훅)는 회고 완료 전까지 도구를 제한합니다:

- **차단**: Bash, Agent, Git 관련 도구
- **허용**: Read, Write, Edit, Glob, Grep, TodoWrite (메모리 작업용)
- **세션 인식**: 감사를 완료한 세션만 차단 (다른 세션은 영향 없음)
- **Fail-open**: 오류 시 통과 허용 (시스템 잠금 방지)

### 지연 회고 (Deferred Retrospective)

서브에이전트(implementer)는 session-gate를 통과하므로 직접 회고를 수행할 수 없습니다:

1. `subagent-stop.mjs`가 implementer 종료를 감지
2. `deferred_to_orchestrator` 플래그 설정 → retro-marker에 기록
3. orchestrator가 대신 회고를 수행

이것은 원칙의 예외가 아니라 기술적 한계에 의한 대행입니다.

### 회고 절차

1. Bash/Agent 차단 (Read/Write/Edit만 가능)
2. **즉시** 회고를 제시합니다 (사용자 지시를 기다리지 않음):
   - 이번 사이클에서 잘된 것
   - 문제였던 것 (솔직한 개선점)
   - 개선할 것
3. 사용자와 피드백을 교환합니다
4. 피드백에서 반복 가능한 원칙을 메모리에 기록합니다
5. 메모리를 정리합니다 — 중복/stale 항목 제거
6. `echo session-self-improvement-complete` 실행 → 게이트 해제
7. orchestrator: `/consensus-loop:merge` → squash merge → 단일 커밋
8. orchestrator: 세션 핸드오프 작성 → 다음 WB 선택

## 정책 파일 참조

감사 기준은 코드가 아닌 파일로 관리됩니다:

| 파일 | 내용 |
|------|------|
| `templates/references/{locale}/rejection-codes.md` | 반려 코드 정의 + 심각도 |
| `templates/references/{locale}/test-checklist.md` | 테스트 충분성 기준 |
| `templates/references/{locale}/output-format.md` | 감사 결과 형식 규칙 |
| `templates/references/{locale}/evidence-format.md` | 증거 패키지 형식 |
| `templates/references/{locale}/done-criteria.md` | 완료 기준 21개 (CQ/T/CC/CL/S/I/FV) |
| `templates/references/{locale}/principles.md` | 코드 품질 원칙 |

이 파일들을 읽으면 감사자가 어떤 기준으로 판정하는지 미리 파악할 수 있습니다.
