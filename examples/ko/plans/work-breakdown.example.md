# 작업 분해: 감사 프로토콜 — 합의 루프

## 작업 원칙

- 플러그인은 반드시 자기완결이어야 함: 디렉토리 외부에 상태 없음
- `config.json`이 유일한 커스터마이징 지점 — 태그나 경로 변경을 위해 코드를 수정해서는 안 됨
- 품질 규칙과 합의 루프는 같은 프로토콜의 두 측면이지, 별개 관심사가 아님
- Linux와 Windows 모두 `config.json`에 환경별 분기 없이 동작해야 함
- 세션 연속성(재개 vs 신규)은 `session.id`가 제어 — 호출자가 결정하지 않음

## 권장 순서

1. `CL-1` 핵심 합의 루프 (트리거 → 감사 → 합의)
2. `CL-2` 미확인 응답 자동 동기화
3. `CL-3` 품질 규칙 통합 (ESLint, npm audit)
4. `CL-4` 플래닝 문서 동기화 (gpt-only 정규화 패스)
5. `CL-5` 설정 추출 + Linux/Windows 호환성
6. `CL-6` plans/ 문서 구조

## CL-1 핵심 합의 루프

- 목표:
  - watch_file 편집 + trigger_tag → audit_script → agree_tag 감지
- 선행 조건:
  - 없음
- 주요 파일:
  - `.claude/hooks/consensus-loop/index.mjs`
  - `.claude/hooks/consensus-loop/audit.mjs`
  - `.claude/hooks/consensus-loop/config.json`

## CL-2 미확인 응답 자동 동기화

- 목표:
  - 임의 파일 편집 → 응답 파일이 감시 파일보다 최신인지 확인 → respond_script 실행
- 선행 조건:
  - CL-1
- 주요 파일:
  - `.claude/hooks/consensus-loop/index.mjs`
  - `.claude/hooks/consensus-loop/respond.mjs`

## CL-3 품질 규칙 통합

- 목표:
  - config의 quality_rules → 편집 파일 매칭 → 즉시 검사 명령 실행 → 오류 출력
- 선행 조건:
  - CL-1
- 주요 파일:
  - `.claude/hooks/consensus-loop/index.mjs`
  - `.claude/hooks/consensus-loop/config.json`

## CL-4 플래닝 문서 동기화

- 목표:
  - planning_files 편집 → respond_script --gpt-only로 gpt-only 정규화 패스
- 선행 조건:
  - CL-2
- 주요 파일:
  - `.claude/hooks/consensus-loop/index.mjs`
  - `.claude/hooks/consensus-loop/config.json`

## CL-5 설정 추출 + 호환성

- 목표:
  - 모든 태그·경로·규칙을 config.json으로 추출; cli-runner.mjs가 Windows/Linux 바이너리 해석 담당
- 선행 조건:
  - CL-1, CL-3
- 주요 파일:
  - `.claude/hooks/consensus-loop/config.json`
  - `.claude/hooks/consensus-loop/cli-runner.mjs`

## CL-6 Plans 문서 구조

- 목표:
  - plans/en/ + plans/ko/ README와 work-breakdown을 docs/en/design/improved/ 형식으로 작성
- 선행 조건:
  - CL-1 ~ CL-5
- 주요 파일:
  - `.claude/hooks/consensus-loop/plans/en/README.md`
  - `.claude/hooks/consensus-loop/plans/en/work-breakdown.md`
  - `.claude/hooks/consensus-loop/plans/ko/README.md`
  - `.claude/hooks/consensus-loop/plans/ko/work-breakdown.md`
