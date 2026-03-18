# 합의 루프 — 플러그인 레퍼런스

> 상태: `active` | 범위: `.claude/hooks/consensus-loop`

Claude와 외부 감사자(GPT/Codex) 간 **태그 기반 2자 합의 프로토콜** + **HITL 회고 게이트**를 구현하는 훅 플러그인.

편집→감사→합의→회고→커밋 사이클을 자동으로 강제한다.

---

## 존재 이유

1. **독립 비평** — 작성하는 AI(Claude)와 검토하는 AI(GPT)를 분리. 동일 모델은 자신의 맹점을 잡지 못한다.
2. **합의 없이 전진 없음** — `[trigger_tag]` 항목은 `[agree_tag]`로 승격될 때까지 미완성.
3. **자동 회고** — 합의 완료 후 session-gate가 커밋을 차단하고, AI 에이전트가 자동으로 회고를 시작. 사용자 지시 불필요.
4. **정책을 코드가 아닌 데이터로** — 감사 기준, 반려 코드, 출력 형식은 `references/` 파일에서 관리. 코드 변경 없이 팀 정책 조정 가능.

---

## 폴더 구조

```
consensus-loop/
│
├── .claude-plugin/
│   ├── plugin.json        ← 플러그인 메타데이터 (이름, 버전, 저자)
│   └── marketplace.json   ← 마켓플레이스 등록 정보
│
├── hooks/
│   └── hooks.json         ← 훅 이벤트 등록 (플러그인 시스템 자동 발견)
│
├── skills/                ← 슬래시 명령 스킬 (자동 발견, 접두사: consensus-loop:)
│   ├── orchestrator/      ← consensus-loop:orchestrator — 멀티트랙 분배 + 에이전트 레지스트리
│   ├── implementer/       ← consensus-loop:implementer — 헤드리스 워커 (워크트리, SendMessage 보정)
│   ├── verify-implementation/ ← consensus-loop:verify — done-criteria 검증
│   ├── merge-worktree/    ← consensus-loop:merge — 워크트리 결과 스쿼시 머지
│   ├── planner/           ← consensus-loop:planner — 플래닝 + 작업 분해
│   └── consensus-loop/    ← consensus-loop:guide — 증거 패키지 가이드
│
├── agents/                ← 에이전트 정의 파일
├── commands/              ← CLI 명령 (자동 발견)
│
├── context.mjs            ← 공유 모듈: config, 경로, 파서, i18n 캐시
├── index.mjs              ← PostToolUse 훅 진입점
├── audit.mjs              ← trigger_tag 감지 시 GPT/Codex 감사 실행
├── respond.mjs            ← claude.md ↔ gpt.md 동기화, 태그 승격/강등
├── retrospective.mjs      ← 합의 완료 후 회고 마커 설정
├── session-gate.mjs       ← PreToolUse 훅: 회고 미완료 시 Bash/커밋 차단
├── session-start.mjs      ← SessionStart 훅: 세션 ID 할당
├── session-stop.mjs       ← Stop 훅: 세션 종료 시 정리
├── cli-runner.mjs         ← CLI 바이너리 경로 해석 (Windows + Linux)
├── i18n.mjs               ← 로케일 헬퍼 (standalone)
│
├── locales/               ← UI 문자열
│   ├── en.json
│   └── ko.json
│
├── templates/
│   ├── audit-prompt.md    ← Facade (~30줄) → references 참조
│   ├── fix-prompt.md      ← Facade → references 참조
│   ├── retro-prompt.md    ← Facade → references 참조
│   └── references/        ← 팀 정책 파일 (코드 변경 없이 수정 가능)
│       ├── ko/            ← 한국어 정책
│       └── en/            ← 영문 정책
│
├── tests/
├── plans/                 ← 예제 플래닝 문서 (ko/en)
├── examples/              ← 예제 config + 템플릿
│
└── (자동 생성 — gitignored)
    REPO_ROOT/.claude/에 생성:
    ├── audit.lock         ← 백그라운드 감사 PID + TTL (동시 실행 방지)
    ├── audit-bg.log       ← 실시간 감사 로그
    └── audit-debounce.ts  ← 연속 편집 디바운스 타임스탬프
    플러그인 로컬:
    ├── config.json
    ├── .session-state/    ← retro-marker.json (세션 게이트 상태)
    ├── ack.timestamp
    ├── session.id
    ├── debug.log
    └── codex-session.log
```

---

## 동작 흐름

```
코드 편집 → PostToolUse 훅
    │
    ├─ watch_file + trigger_tag? → audit.mjs (GPT/Codex 감사)
    │                                  ↓
    │                            gpt.md 생성 (+ 타임스탬프 자동 추가)
    │                                  ↓
    │                            respond.mjs (태그 동기화)
    │                                  ↓
    │                    ┌─── [agree_tag] → retrospective.mjs
    │                    │                       ↓
    │                    │                 retro-marker 설정
    │                    │                       ↓
    │                    │                 session-gate가 Bash 차단
    │                    │                       ↓
    │                    │                 HITL 회고 (사용자 + AI)
    │                    │                       ↓
    │                    │                 echo session-self-improvement-complete
    │                    │                       ↓
    │                    │                 git commit 허용
    │                    │
    │                    └─── [pending_tag] → respond.mjs --auto-fix → 보정
    │
    ├─ gpt.md 최신? → respond.mjs (자동 동기화)
    ├─ 플래닝 파일? → respond.mjs --gpt-only
    └─ quality_rule? → 명령 실행 (ESLint, npm audit, …)
```

---

## 세션 게이트 (HITL)

`session-gate.mjs` PreToolUse 훅이 회고 완료를 강제:

- **마커 설정됨** → Bash/Agent 차단, Read/Write/Edit 허용 (메모리 작업용)
- **세션 독립** → 감사를 완료한 세션만 차단 (다른 세션 영향 없음)
- **완료** → `echo session-self-improvement-complete`으로 마커 해제
- **Fail-open** → 에러 시 차단하지 않음 (시스템을 잠그지 않음)

---

## Facade 패턴

프롬프트 템플릿은 ~30줄의 Facade로, 상세 규칙은 references를 참조:

```
audit-prompt.md (30줄)
  → references/{{LOCALE}}/rejection-codes.md
  → references/{{LOCALE}}/test-checklist.md
  → references/{{LOCALE}}/output-format.md
  → references/{{LOCALE}}/principles.md
```

**감사 기준 변경**: `references/ko/rejection-codes.md`만 수정. 코드 변경 불필요.

---

## 공유 모듈 (context.mjs)

모든 스크립트가 공유하는 단일 소스:

- config.json 1회 파싱
- 경로 해석 메모이제이션 (`findWatchFile`, `findRespondFile`)
- 태그 상수 + 정규식
- 마크다운 파서 (`readSection`, `replaceSection`, `extractStatusFromLine` 등 16개)
- i18n 캐시 (`createT`)

---

## 빠른 시작

### 방법 A: Claude Code 플러그인 (권장)

```bash
claude plugin add berrzebb/consensus-loop
```

모든 훅(`SessionStart`, `Stop`, `PreToolUse`, `PostToolUse`, `SubagentStop`)과 스킬이 자동 등록됩니다.

### 방법 B: 로컬 개발 (`--plugin-dir`)

```bash
claude --plugin-dir .claude/hooks/consensus-loop
```

소스 변경 후 캐시 갱신 필요: `rm -rf ~/.claude/plugins/cache/consensus-loop`

### 방법 C: 수동 설정 (레거시)

**1. 복사:**
```
cp -r consensus-loop  <your-repo>/.claude/hooks/
```

**2. 훅 등록 (`.claude/settings.local.json`):**
```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node .claude/hooks/consensus-loop/session-start.mjs" }] }
    ],
    "PreToolUse": [
      { "hooks": [{ "type": "command", "command": "node .claude/hooks/consensus-loop/session-gate.mjs", "timeout": 10000 }] }
    ],
    "PostToolUse": [
      { "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "node .claude/hooks/consensus-loop/index.mjs", "timeout": 30000 }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node .claude/hooks/consensus-loop/session-stop.mjs", "async": true, "timeout": 120 }] }
    ]
  }
}
```

**3. config 복사 후 수정:**
```
cp examples/config.example.json config.json
```

**4. 템플릿 + references 복사:**
```
cp -r examples/templates/ templates/
```

references 파일을 팀 정책에 맞게 조정.

---

## 설정 레퍼런스

```jsonc
{
  "plugin": {
    "locale":          "ko",
    "audit_script":    "audit.mjs",
    "audit_prompt":    "templates/audit-prompt.md",
    "respond_script":  "respond.mjs",
    "fix_prompt":      "templates/fix-prompt.md",
    "respond_file":    "gpt.md",
    "retro_script":    "retrospective.mjs",
    "retro_prompt":    "templates/retro-prompt.md",
    "ack_file":        "ack.timestamp",
    "session_file":    "session.id",
    "debug_log":       "debug.log"
  },
  "consensus": {
    "watch_file":      "feedback/claude.md",
    "trigger_tag":     "[GPT미검증]",
    "agree_tag":       "[합의완료]",
    "pending_tag":     "[계류]",
    "planning_dirs":   ["docs/ko/design/improved"],
    "sections": { ... },
    "doc_patterns": { ... }
  },
  "quality_rules": [ ... ]
}
```

---

## 템플릿 변수

| 변수 | 사용처 | 치환 내용 |
|---|---|---|
| `{{SCOPE}}` | audit | 감사 범위 |
| `{{PROMOTION_SECTION}}` | audit | 승격 후보 블록 |
| `{{CLAUDE_MD_PATH}}` | 전체 | watch_file 절대경로 |
| `{{GPT_MD_PATH}}` | 전체 | gpt.md 절대경로 |
| `{{TRIGGER_TAG}}` / `{{AGREE_TAG}}` / `{{PENDING_TAG}}` | 전체 | 태그 값 |
| `{{LOCALE}}` | 전체 | 현재 로케일 (ko/en) |
| `{{CORRECTIONS}}` | fix | GPT 수정 사항 |
| `{{AGREED_ITEMS}}` | retro | 합의 완료 항목 |

---

## 환경 변수

| 변수 | 설명 |
|---|---|
| `FEEDBACK_LOOP_ACTIVE=1` | 재진입 방지 (자식 프로세스에 자동 설정) |
| `FEEDBACK_HOOK_DRY_RUN=1` | 드라이런 모드 |
| `CODEX_BIN` | Codex CLI 경로 오버라이드 |
| `CLAUDE_BIN` | Claude CLI 경로 오버라이드 |
| `RETRO_SESSION_ID` | 회고 마커에 기록되는 세션 ID |
| `VITEST_SHARD` | 설정 시 커버리지 threshold 비활성화 |
