# principles 예제 (한국어)

이 파일을 `templates/references/ko/principles.md`로 복사하고 프로젝트에 맞게 수정하세요.

감사 시 적용하는 코드 품질 및 보안 원칙입니다.
- 설계 원칙 테이블에 팀 고유 원칙을 추가할 수 있습니다
- 보안 원칙은 OWASP TOP 10 기반이며, 도메인별 항목을 추가하세요

---

# 코드 품질 원칙

> 감사 시 적용하는 코드 품질 및 보안 원칙입니다. 팀 정책에 맞게 항목을 추가/수정하세요.

## 설계 원칙 (구조 회귀 감지용)

| 원칙 | 위반 신호 | 감사 판단 |
|------|----------|----------|
| **SOLID** | 단일 파일에 여러 책임, 인터페이스 미분리 | `principle-drift` |
| **YAGNI** | 현재 요구사항에 없는 기능 추가 | `principle-drift` |
| **DRY** | 동일 로직이 2곳 이상에 복사 | `principle-drift` |
| **KISS** | 불필요한 추상화, 과잉 설계 | `principle-drift` |
| **LoD** | 깊은 체이닝 (`a.b.c.d.method()`) | `principle-drift` |

## 보안 원칙 (OWASP TOP 10)

| 항목 | 확인 사항 | 감사 판단 |
|------|----------|----------|
| **A01 접근 제어** | 모든 엔드포인트에 scope guard 존재 | `security-drift` |
| **A02 암호화 실패** | 민감 데이터 평문 저장/전송 여부 | `security-drift` |
| **A03 인젝션** | SQL/NoSQL/OS 명령 인젝션 방어 | `security-drift` |
| **A04 불안전한 설계** | 비즈니스 로직 레벨 보안 누락 | `security-drift` |
| **A05 보안 설정 오류** | 기본 자격증명, 불필요한 기능 활성화 | `security-drift` |
| **A06 취약 컴포넌트** | 알려진 취약점이 있는 의존성 | `security-drift` |
| **A07 인증 실패** | 세션 관리, 토큰 검증 누락 | `security-drift` |
| **A08 무결성 실패** | 서명 미검증, 신뢰할 수 없는 소스 | `security-drift` |
| **A09 로깅 부족** | 보안 이벤트 로깅 미비 | `security-drift` |
| **A10 SSRF** | 사용자 입력 URL 미검증 | `security-drift` |

## 공격자 관점 검증

- "이 코드를 어떻게 뚫을 수 있는가?"에서 출발
- wdir 조작, 크로스팀 직접 접근, 세션 키 유추, 외부 API 직접 호출 등 벡터 나열
- 취약점이 발견되면 `security-drift [major]`
