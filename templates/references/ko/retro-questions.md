# 회고 질문

> 감사 사이클 완료 후 회고에서 사용하는 질문입니다. 팀에 맞게 질문을 추가/수정하세요.

## ① 잘된 것

- 설계/구현이 잘 동작한 것은?
- 감사자와 구현자 간 협업이 효과적이었던 것은?
- 재사용 가능한 패턴이나 원칙이 있는가?

## ② 문제인 것

- 반복 수정이 필요했던 것은?
- 비효율적이었거나 불명확했던 것은?
- 지적/계류가 발생한 근본 원인은?

## ③ 메모리 정리

- 상세 기준 → `references/{{LOCALE}}/memory-cleanup.md` 참조
- 중복/stale 메모리 파일 식별 → 정리
- 코드에서 파생 가능한 메모리 → 삭제
- 새로 얻은 원칙 → 메모리에 기록

## ④ 양방향 피드백

- AI → 사용자: 협업 방식에 대한 솔직한 피드백
- 사용자 → AI: 개선해야 할 점

## ⑤ Act — 개선 항목 등록 (PDCA)

`act_analyze` 도구 (또는 `node tool-runner.mjs act_analyze`)를 실행하여 감사 이력 + FVM 결과에서 구조화된 개선 항목을 생성합니다.

1. 지표와 개선 항목을 사용자와 리뷰
2. 사용자가 각 항목을 승인, 수정, 또는 거부
3. 승인된 항목을 `work-catalog.md`의 `## Act Improvements` 섹션에 추가
4. 이 항목들이 다음 Plan 사이클의 입력이 됨

work-catalog 등록 형식:
```markdown
| ID | Work item | Type | Source | Priority |
|---|---|---|---|---|
| ACT-A-1 | CC-2 반려 정책 검토 (FP율 40%) | policy | audit_history | high |
| ACT-F-1 | FVM page→endpoint tier 매핑 개선 | tooling | fvm_validate | medium |
```

## 주의사항

- **코드를 직접 수정하지 마세요** — 개선 필요 사항은 제안만
- **사용자 확인 없이 진행하지 마세요** — 각 단계마다 피드백 대기
