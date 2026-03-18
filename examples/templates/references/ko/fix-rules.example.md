# fix-rules 예제 (한국어)

이 파일을 `templates/references/ko/fix-rules.md`로 복사하고 프로젝트에 맞게 수정하세요.

감사자 반려 후 보정 작업 시 적용하는 규칙입니다.
- 범위 규칙은 감사 사이클의 scope creep을 방지합니다
- 검증 순서의 도구 명령을 프로젝트에 맞게 변경하세요

---

# 보정 규칙

> GPT 감사자의 반려 후 보정 작업 시 적용하는 규칙입니다. 팀 정책에 맞게 조정하세요.

## 범위 규칙

- 보정 대상과 **무관한 범위 확장 금지** — 범위 밖 작업은 분리
- 현재 감사 트랙의 항목만 수정
- 다른 트랙 항목을 `{{TRIGGER_TAG}}` 섹션에 합산 금지

## 코드 수정 규칙

- 수정은 항상 `SOLID/YAGNI/DRY/KISS/LoD` 5원칙을 현재 범위 안에서 준수
- 상세 원칙 → `references/{{LOCALE}}/principles.md` 참조

## 검증 순서

1. **lint 먼저** — `npx eslint <수정된 파일>` 파일별 실행, 통과 필수
2. **테스트** — 기존 테스트 실행 + 필요 시 신규 테스트 추가
3. **tsc** — `npx tsc --noEmit` 통과 확인

## 증거 제출

- 상세 형식 → `references/{{LOCALE}}/evidence-format.md` 참조
- `{{CLAUDE_MD_PATH}}`를 Write 도구로 전체 교체
- 설계 문서 수정 금지
