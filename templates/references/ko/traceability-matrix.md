# 요구사항 추적 매트릭스 (RTM)

> 합의 루프의 단일 진실 소스.
> 3가지 매트릭스로 완전한 추적: 순방향, 역방향, 양방향.

## 원천 문서

| 문서 | 역할 |
|------|------|
| `execution-order.md` | 트랙 순서 + 의존 그래프 |
| `{domain}/README.md` | 트랙 범위, 경계, 완료 기준 |
| `{domain}/work-breakdown.md` | **요구사항 ID 원천** — 파일, 구현 내용, 테스트, 완료 기준 |
| `work-catalog.md` | 트랙 간 ID 인덱스 (A1, B2, EV-3...) |
| `feedback-promotion.md` | 합의 후 다음 트랙 자동 승격 |

---

## 1. 순방향 추적 매트릭스

**질문**: "모든 요구사항이 구현되고 테스트되었는가?"
**방향**: 요구사항 → 설계 → 코드 → 테스트

탐지: **구현 누락, 테스트 누락, 미연결 산출물**

```markdown
# 순방향 RTM: [track-name]

| Req ID | Description | Track | Design Ref | File | Exists | Impl | Test Case | Test Result | Connected | Invariant | Inv Test | Status |
|--------|-------------|-------|------------|------|--------|------|-----------|-------------|-----------|-----------|----------|--------|
| EV-1 | EvalCase contract | evaluation-pipeline | EV/README | src/evals/types.ts | ❌ | — | — | — | EV-2:runner.ts | — | — | open |
| FR-17 | hold once per turn | ui | UI/README | ui/panels.py | ✅ | ✅ | tests/test_panels.py | ✓ | — | hold 1회 제한 | ❌ 존재성만 | invariant-gap |
```

### 컬럼 정의

| 컬럼 | 소유자 | 설명 |
|------|--------|------|
| **Req ID** | work-breakdown.md | 불변. 원천: `{domain}/work-breakdown.md` |
| **Description** | work-breakdown.md | "구현 내용"의 항목 |
| **Track** | execution-order.md | 도메인 폴더명 |
| **Design Ref** | README.md | 설계 문서 섹션 참조 |
| **File** | work-breakdown.md | "첫 수정 파일" / "경계" / "프론트엔드"의 대상 파일 |
| **Exists** | 스카우트 | ✅ / ❌ — 코드베이스 대조 |
| **Impl** | 스카우트 | ✅ 완료 / ⚠️ partial-impl / 🔌 partial-wiring / ❌ 미구현 / — (파일 부재) |
| **Test Case** | 스카우트 → 구현자 | 테스트 파일:라인, `self`=자기 자신이 테스트, — 부재 |
| **Test Result** | 구현자 | ✓ pass / ✗ fail / — pending |
| **Connected** | 스카우트 | 하류 소비자 `Req ID:file` (import 추적) |
| **Coverage** | coverage_map 도구 | 테스트 커버리지 JSON에서 stmt% / br% / fn% |
| **Invariant** | test-strategy.md | 이 행에 해당하는 핵심 불변조건. `—` = 해당 없음 |
| **Inv Test** | 스카우트 → 감사자 | ✅ semantic assertion 존재 / ⚠️ 존재성만 / ❌ 없음 / — 해당 없음 |
| **Runtime** | 스카우트 → 감사자 | ✅ 런타임 경로에서 소비됨 / ⚠️ 인스턴스화만 / ❌ 미연결 / — 해당 없음 |
| **Status** | 전체 | open → wip → fixed → verified / invariant-gap / **integration-gap** (구현 존재, 런타임 미연결) |

---

## 2. 역방향 추적 매트릭스

**질문**: "모든 테스트/코드가 요구사항으로 역추적되는가?"
**방향**: 테스트 → 코드 → 설계 → 요구사항

탐지: **고아 테스트, 불필요 코드, 요구사항 없는 구현**

```markdown
# 역방향 RTM: [track-name]

| Test File | Test Description | Source File | Impl Function | Req ID | Design Ref | Traced |
|-----------|-----------------|-------------|---------------|--------|------------|--------|
| tests/evals/loaders.test.ts | loader contract | src/evals/loaders.ts | loadDataset() | EV-1 | EV/README | ✅ |
| tests/evals/runner.test.ts | smoke test | src/evals/runner.ts | runEval() | EV-2 | EV/README | ✅ |
| tests/bus/orphan.test.ts | legacy test | src/bus/old.ts | — | — | — | ❌ orphan |
```

### 컬럼 정의

| 컬럼 | 소유자 | 설명 |
|------|--------|------|
| **Test File** | 스카우트 | 코드베이스의 기존 테스트 파일 |
| **Test Description** | 스카우트 | 테스트가 검증하는 내용 |
| **Source File** | 스카우트 | 테스트가 import하는 구현 파일 |
| **Impl Function** | 스카우트 | 테스트 대상 함수/클래스 |
| **Req ID** | 스카우트 | work-breakdown으로 역추적. — 매칭 없음 |
| **Design Ref** | 스카우트 | 설계 문서. — 매칭 없음 |
| **Traced** | 스카우트 | ✅ 완전 추적 / ⚠️ 부분 / ❌ orphan (요구사항 없음) |

---

## 3. 양방향 추적 매트릭스

**질문**: "요구사항과 테스트가 누락 없이 연결되어 있는가?"
**방향**: 요구사항 ↔ 테스트 (교차 참조)

탐지: **양방향 커버리지 갭**

```markdown
# 양방향 RTM: [track-name]

| Req ID | Description | Has Code | Has Test | Test → Req | Req → Test | Gap |
|--------|-------------|----------|----------|------------|------------|-----|
| EV-1 | EvalCase contract | ❌ | ❌ | — | — | code + test missing |
| EV-2 | local runner | ❌ | ❌ | — | — | code + test missing |
| — | — | ✅ | ✅ | ❌ | — | orphan test (no req) |
```

### 컬럼 정의

| 컬럼 | 설명 |
|------|------|
| **Req ID** | work-breakdown 원천. `—` = 고아 코드/테스트 |
| **Description** | 요구사항 또는 고아 항목 설명 |
| **Has Code** | ✅ 구현 존재 / ❌ 미존재 |
| **Has Test** | ✅ 테스트 존재 / ❌ 미존재 |
| **Test → Req** | 역방향: 테스트가 이 요구사항으로 추적됨 |
| **Req → Test** | 순방향: 요구사항에 커버링 테스트 있음 |
| **Gap** | 누락 요약 |

---

## 스카우트 절차

스카우트는 전체 트랙을 읽고 3가지 매트릭스를 모두 생성.

### 1. 의존 그래프 구성
`execution-order.md` → 트랙 의존 관계 + 하류 소비자 매핑.

### 2. 각 트랙의 work-breakdown 읽기
각 Req ID에서 추출:
- 대상 파일 ("첫 수정 파일", "경계", "프론트엔드")
- 구현 내용
- 테스트 설명
- 완료 기준
- 선행 조건

### 3. 순방향 스캔 (요구사항 → 코드)
각 Req ID × File: Exists, Impl, Test Case, Connected 확인.

### 4. 역방향 스캔 (테스트 → 요구사항)
트랙 범위 내 기존 테스트 파일:
- import 역추적 → 소스 파일 → Req ID 매칭
- 매칭 없으면 orphan 표시

### 5. 양방향 요약
순방향 + 역방향 결과 교차 참조 → 갭 분석.

### 6. 트랙 간 연결 감사
execution-order 의존 관계에 따라 import 체인 추적.

## 생명주기

| 단계 | 주체 | 행동 |
|------|------|------|
| **생성** | 스카우트 | work-breakdown vs 코드베이스 대조 → 3가지 매트릭스 생성 |
| **분배** | 오케스트레이터 | 순방향 RTM의 open 행을 구현자에게 할당 |
| **구현** | 구현자 | 순방향 RTM 갱신: Exists, Impl, Test Case, Test Result |
| **검증** | 감사자 | 역방향 RTM으로 각 수정이 요구사항에 추적됨을 확인 |
| **보정** | 구현자 | ❌ 판정 행만 재진입 |
| **종결 전 검증** | 스카우트 | **필수 재스캔** — 제출된 행뿐 아니라 모든 행 검증 |
| **종료** | 오케스트레이터 | 양방향 RTM에 갭 0 → 트랙 완료 |

## 증분 갱신

플래너가 새 작업 패키지 추가 시:
- 스카우트: 새 Req ID 행만 순방향 RTM에 추가
- 새 테스트 파일만 역방향 스캔
- 양방향 요약 재생성
- 기존 행 변경 없음 — 전체 재스캔 불필요

## 증거 제출 형식

순방향 RTM이 주요 증거. watch_file에 제출:

```markdown
## [trigger_tag] [track-name] — 처리된 Req IDs

### 순방향 추적 매트릭스
(이번 제출에서 갱신된 행)

### Test Command
(수정된 행 검증 명령)

### Test Result
(터미널 출력)

### Residual Risk
미처리 행: EV-3 (지연 — EV-2 완료 필요)
```

## 토큰 효율

매트릭스 비용 = `행 × ~130자/행` (결정론적).
30행 트랙 × 3가지 매트릭스 ≈ 3,000 토큰 — 고정.
스카우트 비용: 1회. 이후 모든 세션에 상각.
