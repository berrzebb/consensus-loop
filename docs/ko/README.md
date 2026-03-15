# 합의 루프 — 플러그인 레퍼런스

> 상태: `active` | 범위: `.claude/hooks/consensus-loop`

Claude와 외부 감사자(GPT/Codex) 간 **태그 기반 2자 합의 프로토콜**을 구현하는 자기완결(self-contained) PostToolUse 훅 플러그인.

범용 웹훅 시스템을 만드는 것이 목표가 아니라, 편집→감사→합의 사이클에 안정적이고 설정 중심의 근거지를 마련하여 어느 프로젝트든 디렉토리 하나를 복사하고 `config.json`만 수정하면 채택할 수 있도록 한다.

---

## 폴더 구조

```
consensus-loop/
├── index.mjs              ← PostToolUse 훅 진입점
├── audit.mjs              ← trigger_tag 감지 시 GPT/Codex 감사 실행
├── respond.mjs            ← claude.md ↔ gpt.md 동기화, 합의 항목 승격
├── cli-runner.mjs         ← CLI 바이너리 경로 해석 (Windows + Linux)
├── config.json            ← 실사용 설정 (examples/plans/config.example.json 복사 후 수정)
│
├── templates/             ← 활성 프롬프트 템플릿 (직접 수정하여 사용)
│   ├── audit-prompt.md    ← 감사 시 GPT에게 전달되는 시스템 프롬프트
│   └── fix-prompt.md      ← 반려 후 Claude에게 전달되는 수정 지시 프롬프트
│
├── feedback/              ← 실사용 피드백 파일 (consensus.watch_file로 참조)
│   ├── claude.md          ← Claude가 작성; trigger_tag 존재 시 감사 실행
│   └── gpt.md             ← GPT가 감사 결과를 작성하는 파일
│
├── docs/
│   ├── en/README.md       ← 영문 문서
│   └── ko/README.md       ← 이 파일
│
├── examples/              ← 참고 자료; 복사 후 수정하여 사용
│   ├── plans/
│   │   ├── config.example.json          ← 주석이 달린 전체 설정 레퍼런스
│   │   ├── en/
│   │   │   ├── execution-order.example.md   ← 전체 트랙/마일스톤 실행 순서
│   │   │   ├── work-catalog.example.md      ← 트랙/작업 카탈로그
│   │   │   ├── work-breakdown.md            ← 항목 단위 분해 형식
│   │   │   └── sample-track/
│   │   │       └── README.example.md        ← 트랙별 설계 문서
│   │   └── ko/                              ← 한국어 대응 파일
│   └── templates/
│       ├── en/
│       │   ├── audit-prompt.example.md  ← audit-prompt.md 시작점
│       │   └── fix-prompt.example.md    ← fix-prompt.md 시작점
│       └── ko/                          ← 한국어 대응 파일
│
└── (자동 생성 상태 파일 — 수정 금지)
    ├── ack.timestamp      ← GPT ack 중복 방지 가드
    ├── session.id         ← 현재 Claude 세션 ID
    └── debug.log          ← 훅 실행 로그
```

---

## 존재 이유

AI는 그럴듯하게 틀린다. 같은 AI에게 자신의 출력을 검토하게 하면 맹점이 반복된다.

이 루프는 세 가지 원칙을 강제한다:

1. **독립 비평** — 작성하는 AI(Claude)와 검토하는 AI(GPT)를 분리한다. 동일 모델은 자신의 실수를 신뢰성 있게 발견하지 못한다.
2. **합의 없이 전진 없음** — `[GPT미검증]`이 붙은 항목은 `[합의완료]`로 승격될 때까지 미완성이다. 검증되지 않은 변경이 축적되는 것을 막는다.
3. **이터레이션 끝의 회고** — 합의 완료 후 "잘된 것 / 문제 / 개선점"을 기록한다. 반성은 `feedback/*.md`에 영속되어 다음 세션 컨텍스트에 주입되고 동일한 실수가 반복되지 않는다.

합의 루프는 이 규율을 자발적 의지가 아닌 자동 강제로 만드는 인프라다.

---

## 동작 흐름

```
PostToolUse (임의 파일 편집)
        │
        ▼
   index.mjs
        │
        ├─ watch_file 편집 + trigger_tag 존재?
        │       └─→ audit.mjs  (GPT 감사 요청, gpt.md 작성)
        │
        ├─ gpt.md가 claude.md보다 최신?
        │       └─→ respond.mjs  (gpt.md 파싱, claude.md 태그 승격/강등)
        │
        ├─ 플래닝 파일 편집?
        │       └─→ audit.mjs --planning  (정규화 패스만 실행)
        │
        └─ quality_rule 조건과 편집 파일 일치?
                └─→ 설정된 명령 실행 (ESLint, npm audit, …)
```

---

## 빠른 시작

**1. 플러그인 디렉토리를 프로젝트에 복사:**

```
cp -r consensus-loop  <your-repo>/.claude/hooks/
```

**2. `.claude/settings.local.json`에 훅 등록:**

```json
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "node .claude/hooks/consensus-loop/index.mjs" }] }
    ]
  }
}
```

**3. config 복사 후 수정:**

```
cp examples/plans/config.example.json config.json
```

`consensus.watch_file`, `consensus.trigger_tag`, `consensus.agree_tag`, `consensus.pending_tag`, `consensus.planning_dirs`를 프로젝트에 맞게 수정한다.

**4. 프롬프트 템플릿 복사 후 수정:**

```
cp examples/templates/ko/audit-prompt.example.md templates/audit-prompt.md
cp examples/templates/ko/fix-prompt.example.md   templates/fix-prompt.md
```

---

## 설정 레퍼런스

```jsonc
{
  "plugin": {
    // 파일명만 — 플러그인 디렉토리 기준으로 해석
    "audit_script":  "audit.mjs",
    "audit_prompt":  "templates/audit-prompt.md",
    "respond_script": "respond.mjs",
    "ack_file":      "ack.timestamp",
    "session_file":  "session.id",
    "debug_log":     "debug.log",
    "fix_prompt":    "templates/fix-prompt.md"
  },
  "consensus": {
    // 레포 루트 기준 경로
    "watch_file":    "feedback/claude.md",   // Claude 파일; 편집이 루프를 구동
    "trigger_tag":   "[GPT미검증]",           // 감사를 트리거하는 태그
    "agree_tag":     "[합의완료]",             // 합의 완료를 표시하는 태그
    "pending_tag":   "[계류]",                // 보류 항목을 표시하는 태그
    "planning_files": [],                    // 명시적 파일 목록 (레포 루트 기준)
    "planning_dirs":  [                      // 이 디렉토리 하위 모든 파일이 플래닝 문서
      ".claude/hooks/consensus-loop/plans/ko"
    ]
  },
  "quality_rules": [
    {
      "match": { "extension": ".ts", "path_contains": ["/src/", "/tests/"] },
      "label": "eslint",
      "command": "npx eslint --no-error-on-unmatched-pattern \"{file}\""
    }
  ]
}
```

---

## 플래닝 문서 레이아웃

멀티 트랙 프로젝트를 관리할 때 `examples/plans/`의 구조를 따른다:

```
plans/                         ← 레포 스코프 플래닝 디렉토리 (planning_dirs에 추가)
  ko/
    execution-order.md         ← 전체 트랙/마일스톤 실행 순서
    work-catalog.md            ← 트랙별 한 줄 요약
    <track-name>/
      README.md                ← 설계 문서 (목적, 범위, 완료 기준)
      work-breakdown.md        ← 항목 단위 작업 (ST-1, ST-2, …)
  en/                          ← 영문 미러 (동일한 구조)
```

`planning_dirs` 하위의 모든 파일은 플래닝 문서로 처리된다 — 편집 시 전체 감사 없이 GPT 정규화 패스만 실행하여 형식을 일관되게 유지한다.

---

## 프롬프트 템플릿 변수

`templates/audit-prompt.md`와 `templates/fix-prompt.md`에서 사용 가능한 플레이스홀더:

| 변수 | 치환 내용 |
|---|---|
| `{{CORRECTIONS}}` | GPT 수정 사항 불릿 목록 |
| `{{REJECT_CODES}}` | gpt.md의 반려 코드 |
| `{{RESET_CRITERIA}}` | gpt.md의 완료 기준 재고정 |
| `{{NEXT_TASKS}}` | gpt.md의 다음 작업 목록 |
| `{{GPT_MD}}` | gpt.md 전체 원문 |
| `{{WATCH_FILE}}` | `consensus.watch_file` 경로 |
| `{{RESPOND_FILE}}` | gpt.md 경로 |
| `{{TRIGGER_TAG}}` | `consensus.trigger_tag` 값 |

---

## 범위 밖

- 감사 모델 교체 — `config.json`의 `plugin.audit_script`를 변경하는 방식으로 대응
- 웹 UI나 대시보드 추가
- `session.id`와 `debug.log` 이상의 감사 이력 영구 보존
