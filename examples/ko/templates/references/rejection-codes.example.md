# rejection-codes 예제 (한국어)

이 파일을 `templates/references/ko/rejection-codes.md`로 복사하고 프로젝트에 맞게 수정하세요.

감사자가 반려 시 사용하는 코드와 심각도 기준입니다.
- 프로젝트 특성에 맞는 반려 코드를 추가/제거할 수 있습니다
- `done-criteria.md`의 Not-Done Criteria와 일관성을 유지하세요

---

# 반려 코드 정의

> 이 파일을 수정하여 프로젝트에 맞는 반려 기준을 조정하세요.

## 코드 목록

| 코드 | 설명 | 심각도 기준 |
|------|------|------------|
| `needs-evidence` | 증거 패키지 없거나 약함 | `[major]`: 핵심 claim 근거 부재 / `[minor]`: 부분 누락 |
| `scope-mismatch` | claim과 실제 코드 불일치 | `[major]`: 핵심 경로 불일치 / `[minor]`: 문서 표현 차이 |
| `lint-gap` | lint 미실행 또는 실패 | `[major]`: exit code ≠ 0 |
| `test-gap` | 테스트 부재 또는 불충분 | `[major]`: 핵심 경로 미검증 / `[minor]`: 경계 케이스 누락 |
| `claim-drift` | 문서와 코드 동작 불일치 | `[major]`: 동작 차이 / `[minor]`: 문서 오타 |
| `principle-drift` | SOLID/YAGNI/DRY/KISS/LoD 구조 회귀 | `[major]`: 구조적 회귀 / `[minor]`: 경미한 위반 |
| `security-drift` | OWASP TOP 10 위반 또는 공격자 관점 취약점 | `[major]`: 항상 |

## 사용 규칙

- `{{PENDING_TAG}}` 판정 시 1~3개 선택, 심각도 `[major]`/`[minor]` 필수 병기.
- `[major]`: 다음 라운드 `{{AGREE_TAG}}` 불가.
- `[minor]`: 수정 확인 후 pass 허용.
- `lint-gap` 사용 시 구체 지점(파일:L{line} + 오류 메시지) 필수. "N건" 요약 금지.

## 구체 지점 형식

반려 시 `## 구체 지점` 섹션에 정확한 위치를 인용:
```
- `src/routes/resource.ts:L42` — claim은 require_admin이지만 실제는 require_member
- `tests/resource.test.ts:L85` — member 200만 검증, admin 403 미검증
```
