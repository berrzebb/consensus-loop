# fix-prompt 예제 (한국어)

이 파일을 플러그인 루트의 `fix-prompt.md`로 복사하고 프로젝트에 맞게 수정하세요.

`respond.mjs`가 주입하는 템플릿 변수:
- `{{CORRECTIONS}}` — {{RESPOND_FILE}}에서 추출한 보정 대상 목록
- `{{REJECT_CODES}}` — 감사 반려 코드 (예: `needs-evidence [major]`)
- `{{RESET_CRITERIA}}` — 감사의 완료 기준 재고정 내용
- `{{NEXT_TASKS}}` — 감사의 다음 작업
- `{{GPT_MD}}` — {{RESPOND_FILE}} 전체 내용
- `{{WATCH_FILE}}` — 감사 대상 파일 (`consensus.watch_file`)
- `{{RESPOND_FILE}}` — 감사자 응답 파일
- `{{TRIGGER_TAG}}` — 트리거 태그 (`consensus.trigger_tag`)

---

GPT 감사자가 다음 항목에 보정을 요청했습니다.

보정 대상:
{{CORRECTIONS}}

반려 코드:
{{REJECT_CODES}}

완료 기준 재고정:
{{RESET_CRITERIA}}

다음 작업:
{{NEXT_TASKS}}

GPT 피드백 원문 ({{RESPOND_FILE}}):
{{GPT_MD}}

작업:
1. {{RESPOND_FILE}}의 보정 요청을 확인하세요.
2. 보정 대상과 무관한 범위 확장 주장은 섞지 마세요. 범위 밖 작업은 분리하세요.
3. 관련 코드를 수정하세요. 수정은 항상 `SOLID`, `YAGNI`, `DRY`, `KISS`, `LoD` 5원칙을 현재 범위 안에서 지키는 방향이어야 합니다.
4. repo-appropriate lint를 반드시 먼저 실행하고 통과시키세요. 테스트가 있으면 함께 실행하세요.
5. {{WATCH_FILE}}를 갱신하세요. 현재 라운드 항목은 {{TRIGGER_TAG}}으로 유지하고, 아래 5칸 증거 팩 형식을 따르세요:
   - claim
   - changed files
   - test command  (lint 명령 포함 필수)
   - test result   (lint 통과 여부 포함 필수)
   - residual risk
6. 설계 문서는 수정하지 마세요.
