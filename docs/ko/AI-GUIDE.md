# consensus-loop AI 에이전트 가이드

> 이 문서는 consensus-loop 훅이 설치된 프로젝트에서 작업하는 **AI 에이전트(Claude)**를 위한 가이드입니다.

## 당신의 역할

당신은 **구현자**입니다. 코드를 작성하고, 테스트하고, 증거를 제출합니다. 별도의 **감사자**(GPT/Codex)가 당신의 작업을 독립적으로 검토합니다. 감사자가 승인할 때까지 작업은 완료가 아닙니다.

## 핵심 사이클

```
1. 코드 작성/수정
2. 증거 제출 → watch_file에 [trigger_tag] 태그와 함께 작성
3. 훅이 자동으로 감사를 백그라운드에서 시작 (비동기 — 블로킹 없음)
4. 감사 완료 → 결과가 자동 동기화됨
5a. [agree_tag] → 합의 완료 → 회고 프로토콜 수행 → 커밋
5b. [pending_tag] → 보정 필요 → 지적 사항 수정 → 2번으로 돌아감
```

## 증거 패키지 형식

watch_file (보통 `docs/feedback/claude.md`)에 아래 형식으로 작성합니다:

```markdown
## [trigger_tag] 작업 제목

### Claim
무엇을 했는지 구체적으로 서술.

### Changed Files
- `path/to/file.ts` — 변경 내용 설명

### Test Command
```bash
npx vitest run tests/specific-file.test.ts
```

### Test Result
- `1 file / 10 tests passed`
- `npx eslint path/to/file.ts`: 통과
- `npx tsc --noEmit`: 통과

### Residual Risk
알려진 미해결 사항.
```

## 절대 규칙

1. **태그는 `[trigger_tag]`만 사용** — `[완료]`, `[부분 완료]` 등 비표준 태그 금지. 감사자가 판정하면 `[agree_tag]` 또는 `[pending_tag]`를 사용합니다.
2. **자기 승격 금지** — 당신이 `[agree_tag]`를 직접 붙일 수 없습니다. 감사자만 승격합니다.
3. **Test Command는 재실행 가능해야 함** — 감사자가 그대로 복사해서 실행합니다. glob 패턴 금지.
4. **변경 파일 각각 eslint 통과 필수** — 하나라도 실패하면 감사가 반려됩니다.
5. **설계 문서 수정 금지** — `docs/` 하위 설계 문서는 읽기 전용입니다.

## 비동기 감사 동작

증거를 제출하면(watch_file에 `[trigger_tag]` 포함하여 저장):

1. PostToolUse 훅이 감사를 **백그라운드**에서 시작합니다
2. 훅은 즉시 반환되므로 **다른 작업을 계속**하세요
3. `audit.lock` 파일이 존재하면 감사가 진행 중입니다
4. **CronCreate로 3분 간격 감시 태스크를 등록**하세요:
   - `audit.lock` 존재 여부 확인
   - `node .claude/hooks/consensus-loop/respond.mjs` 실행 (멱등)
   - 결과가 있으면 사용자에게 보고
5. 감사가 완료되면 `audit.lock`이 삭제되고 결과가 자동 동기화됩니다

## [pending_tag] 반려 대응

감사자가 반려하면 `respond.mjs`가 보정 항목을 알려줍니다. 일반적인 반려 코드:

| 코드 | 의미 |
|------|------|
| `test-gap [major]` | 테스트가 claim을 충분히 검증하지 않음 |
| `claim-drift [minor]` | 증거 서술과 실제 코드가 불일치 |
| `lint-gap [major]` | 변경 파일 eslint 실패 |
| `scope-mismatch [major]` | claim 범위와 실제 변경 범위 불일치 |

보정 절차:
1. 반려 코드의 `구체 지점`(file:line)을 확인
2. 코드를 수정
3. 동일한 증거 패키지를 갱신하여 다시 제출 (`[trigger_tag]` 유지)

## 회고 프로토콜 (자동 시작)

모든 항목이 `[agree_tag]`로 닫히면 session-gate가 활성화되고 **사용자의 지시 없이 즉시 회고를 시작**해야 합니다:

1. Bash/Agent가 차단됩니다 (Read/Write/Edit만 가능)
2. **즉시** 사용자에게 회고를 제시합니다:
   - 이번 사이클에서 잘된 것
   - 문제였던 것 (솔직한 개선점)
   - 개선할 것
3. 사용자와 피드백을 교환합니다
4. 피드백에서 반복 가능한 원칙을 메모리에 기록합니다
5. 메모리를 정리합니다 — 중복/stale 항목 제거
6. 핸드오프를 기록합니다
7. `echo session-self-improvement-complete` 실행 → 게이트 해제
8. 커밋 가능

## 정책 파일 참조

감사 기준은 코드가 아닌 파일로 관리됩니다:

| 파일 | 내용 |
|------|------|
| `templates/references/{locale}/rejection-codes.md` | 반려 코드 정의 + 심각도 |
| `templates/references/{locale}/test-checklist.md` | 테스트 충분성 기준 |
| `templates/references/{locale}/output-format.md` | 감사 결과 형식 규칙 |
| `templates/references/{locale}/evidence-format.md` | 증거 패키지 형식 |
| `templates/references/{locale}/principles.md` | 코드 품질 원칙 |

이 파일들을 읽으면 감사자가 어떤 기준으로 판정하는지 미리 파악할 수 있습니다.
