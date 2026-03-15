# consensus-loop

> **Claude Code PostToolUse hook** — Claude와 외부 AI 감사자(GPT/Codex) 간의 **태그 기반 2자 합의 프로토콜**을 파일 편집 흐름에 자연스럽게 통합하는 자기완결형 플러그인.

편집→감사→합의 사이클에 안정적이고 설정 중심의 근거지를 마련하여,
어느 프로젝트든 디렉토리 하나를 복사하고 `config.json`만 수정하면 즉시 채택할 수 있습니다.

## 왜 이것이 필요한가

AI는 그럴듯하게 틀린다. 같은 AI에게 자신의 출력을 검토하게 하면 맹점이 반복된다.

이 루프는 세 가지 원칙을 강제한다:

1. **독립 비평** — 작성하는 AI(Claude)와 검토하는 AI(GPT)를 분리한다. 동일 모델은 자신의 실수를 신뢰성 있게 발견하지 못한다.
2. **합의 없이 전진 없음** — `[GPT미검증]`이 붙은 작업은 `[합의완료]`로 승격될 때까지 미완성이다. 검증되지 않은 변경의 축적을 막는다.
3. **이터레이션 끝의 회고** — 합의 완료 후 "잘된 것 / 문제 / 개선점"을 기록한다. 반성은 다음 세션 컨텍스트에 주입되어 동일한 실수가 반복되지 않는다.

합의 루프는 이 규율을 자발적 의지가 아닌 자동 강제로 만드는 인프라다.

---

### 핵심 기능

| 기능 | 설명 |
|---|---|
| **합의 루프** | `watch_file`에 `trigger_tag` 감지 → `audit_script` 실행 → `agree_tag` 도달까지 계류 |
| **자동 동기화** | 응답 파일(`gpt.md`)이 갱신되면 `respond_script`가 자동으로 태그 상태를 승격/강등 |
| **코드 품질 검사** | 파일 편집 즉시 ESLint·npm audit 등 `quality_rules` 실행 |
| **플래닝 정규화** | `planning_dirs` 하위 문서 편집 시 전체 감사 없이 GPT 정규화 패스만 실행 |

---

## 구조

```
.claude/hooks/consensus-loop/
  index.mjs      ← PostToolUse hook 진입점
  config.json    ← 태그·경로 설정
  ack.timestamp  ← 마지막 응답 수신 시각 (자동 생성)
  debug.log      ← 실행 로그 (자동 생성)
```

---

## 동작 원리

```
(A) watch_file 편집 + trigger_tag 존재
     → audit_script 실행 (GPT에 감사 요청)
     → agree_tag 확인 → 합의 완료 or 계류

(B) 다른 파일 편집 시
     → 응답 파일(gpt.md)이 watch_file보다 최신이면
     → respond_script 자동 동기화
```

상태 전이:

```
[GPT미검증]  →  (audit_script 실행)  →  [합의완료]
                                      ↘  [계류]  →  수동 보정
```

---

## config.json 설명

| 키 | 설명 | 기본값 |
|---|---|---|
| `watch_file` | 트리거를 감지할 파일 (상대 경로) | `docs/feedback/claude.md` |
| `trigger_tag` | 감사 요청 태그 | `[GPT미검증]` |
| `agree_tag` | 합의 완료 태그 | `[합의완료]` |
| `pending_tag` | 계류 태그 (표시용) | `[계류]` |
| `audit_script` | 감사 실행 스크립트 | `.claude/hooks/consensus-loop/audit.mjs` |
| `audit_prompt` | 감사 프롬프트 템플릿 경로 | `.claude/hooks/consensus-loop/audit-prompt.md` |
| `respond_script` | 자동 동기화 스크립트 | `.claude/hooks/consensus-loop/respond.mjs` |
| `ack_file` | 마지막 응답 시각 저장 경로 | `.claude/hooks/consensus-loop/ack.timestamp` |
| `session_file` | 감사 세션 ID 저장 경로 | `.claude/hooks/consensus-loop/session.id` |
| `debug_log` | 실행 로그 경로 | `.claude/hooks/consensus-loop/debug.log` |
| `planning_files` | planning 문서 경로 목록 (변경 시 gpt-only 동기화) | `[...]` |

---

## settings.local.json 등록

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "node .claude/hooks/consensus-loop/index.mjs" }
        ]
      }
    ]
  }
}
```

---

## 다른 프로젝트에 이식

1. `consensus-loop/` 디렉토리를 프로젝트의 `.claude/hooks/`에 복사
2. `config.json`에서 태그와 경로를 프로젝트에 맞게 수정
3. `settings.local.json`에 hook 등록

```json
// 예: 다른 합의 루프에 재사용
{
  "watch_file": "docs/review/author.md",
  "trigger_tag": "[REVIEW_NEEDED]",
  "agree_tag": "[APPROVED]",
  "pending_tag": "[CHANGES_REQUESTED]",
  "audit_script": "scripts/request-review.mjs",
  "respond_script": "scripts/sync-review.mjs"
}
```

---

## 환경변수

| 변수 | 설명 |
|---|---|
| `FEEDBACK_LOOP_ACTIVE=1` | 재진입 방지 — 스크립트 내부에서 자동 설정 |
| `FEEDBACK_HOOK_DRY_RUN=1` | 드라이런 — audit_script를 실제 실행하지 않고 로그만 출력 |
