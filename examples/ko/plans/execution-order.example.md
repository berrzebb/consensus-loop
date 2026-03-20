# 개선 작업 실행 순서

> 상태: `planned` | 유형: 실행 순서 인덱스

## 목적

이 문서는 `docs/ko/design/improved/*` 아래 도메인별 설계 문서를
**실행 순서와 선행 관계 기준**으로 정렬한 인덱스다.

## 권장 실행 순서

| 순서 | 도메인 | 선행 조건 | 다음 단계로 넘어가는 기준 |
|---|---|---|---|
| 1 | [sample-track-a](./sample-track-a/README.md) | 없음 | A 완료 기준이 코드와 테스트로 충족됨 |
| 2 | [sample-track-b](./sample-track-b/README.md) | A | B 완료 기준이 코드와 테스트로 충족됨 |
| 3 | [sample-track-c](./sample-track-c/README.md) | A, B | C 완료 기준이 코드와 테스트로 충족됨 |

## 즉시 착수 추천 묶음

현재 기준 병렬 착수 가능:

- sample-track-a — 선행 없음, 단독 진행 가능
