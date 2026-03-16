# 감사 답변 형식

> 이 형식을 기준으로 `{{GPT_MD_PATH}}`를 작성하세요. 프로젝트에 맞게 섹션을 조정하세요.

## 타임스탬프

- 감사 완료 타임스탬프는 **시스템이 자동 추가** — 에이전트가 직접 작성하지 마세요.
- 형식: `> 감사 완료: YYYY-MM-DD HH:MM` (gpt.md 하단에 자동 삽입)

## 필수 섹션 (이것만 유지)

1. `## 감사 범위`
2. `## 독립 검증 결과`
3. `## 최종 판정`
4. `## 반려 코드` (`{{PENDING_TAG}}`일 때만)
5. `## 구체 지점` (`{{PENDING_TAG}}`일 때만)
6. `## 핵심 근거` (3~5줄)
7. `## 완료 기준 재고정` (`{{PENDING_TAG}}`일 때만)
8. `## 다음 작업`

## 예시: {{PENDING_TAG}} 판정

```markdown
## 감사 범위
- [계류] TRACK-1 — 접근 제어 강화

## 독립 검증 결과
- 변경 파일 10개 파일별 `npx eslint` 통과.
- `npx vitest run ...` → 8 files / 120 tests passed.
- `npx tsc --noEmit` 통과.

## 최종 판정
- [계류] TRACK-1 — 접근 제어 강화

## 반려 코드
- `scope-mismatch [major]`
- `test-gap [major]`

## 구체 지점
- `src/routes/resource.ts:L42` — claim은 require_admin이지만 실제는 require_member
- `tests/resource.test.ts:L85` — admin 403 미검증

## 핵심 근거
- lint·tsc·vitest 모두 통과.
- 그러나 GET /api/resource의 claim과 실제 권한이 불일치.
- 테스트도 기존 member 기대를 유지해 claim을 잠그지 못함.

## 완료 기준 재고정
- resource 권한을 claim과 일치시키고 403/200 테스트 추가 시 닫힘.

## 다음 작업
- TRACK-1 — `src/routes/resource.ts`의 GET /api/resource 권한 변경 + `tests/resource.test.ts`에 직접 검증 추가
```

## 예시: {{AGREE_TAG}} 판정

```markdown
> 감사 시각: 2026-03-16 19:00

## 감사 범위
- [합의완료] TRACK-1 — 접근 제어 강화

## 독립 검증 결과
- 변경 파일 10개 파일별 eslint 통과.
- vitest 8 files / 120 tests passed.
- claim과 코드 일치 확인.

## 최종 판정
- [합의완료] TRACK-1 — 접근 제어 강화

## 핵심 근거
- 모든 엔드포인트에 scope guard 확인. claim-코드 정합성 만족.

## 다음 작업
- TRACK-2 — 다음 미완료 항목
```

## 회귀 follow-up 등록 형식

기존 `{{AGREE_TAG}}` 항목에서 회귀 발견 시:
```
- {{PENDING_TAG}} Regression Follow-up / TRACK-R1 — 이후 변경으로 회귀 발생
```

## 금지 사항

- `## 개선된 프로토콜` 섹션 생성 금지 (존재하면 삭제).
- 다음 작업에 일반론 금지 (`별도 감사로 유지`, `계속 진행`).
