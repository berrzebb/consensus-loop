# 작업 분해: Sample Track

## 작업 원칙

- 각 항목은 독립적으로 commit 가능해야 함
- 완료 기준은 코드 + lint + 테스트로 닫힘
- 선행 조건이 명시되지 않으면 병렬 착수 가능

## 권장 순서

1. `ST-1` 첫 번째 작업
2. `ST-2` 두 번째 작업 (ST-1 이후)
3. `ST-3` 세 번째 작업

## ST-1 첫 번째 작업 제목

- 목표:
  - 이 작업이 고정하거나 변경하는 경계를 1줄로 기술
- 선행 조건:
  - 없음 (또는 다른 ST-N)
- 주요 파일:
  - `src/domain/file.ts`
  - `tests/domain/file.test.ts`
- 완료 기준:
  - `npx eslint src/domain/file.ts` 통과
  - 관련 테스트 통과

## ST-2 두 번째 작업 제목

- 목표:
  - ST-1에서 고정한 경계를 바탕으로 다음 경계를 연결
- 선행 조건:
  - ST-1
- 주요 파일:
  - `src/domain/another.ts`
- 완료 기준:
  - 기능 동작 + lint + 테스트 통과

## ST-3 세 번째 작업 제목

- 목표:
  - 회귀/통합 테스트로 트랙 전체를 닫음
- 선행 조건:
  - ST-1, ST-2
- 주요 파일:
  - `tests/domain/integration.test.ts`
- 완료 기준:
  - 전체 테스트 suite 통과
