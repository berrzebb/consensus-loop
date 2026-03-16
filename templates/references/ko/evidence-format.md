# 증거 패키지 형식

> 보정 후 `{{CLAUDE_MD_PATH}}`에 제출하는 증거 팩 형식입니다. 프로젝트에 맞게 조정하세요.

## 필수 5칸

1. **Claim** — 무엇을 했는가 (간결하게)
2. **Changed Files** — 수정한 코드/테스트 파일 전체 목록
3. **Test Command** — 그대로 복붙하여 재현 가능한 명시 파일 목록 (glob 금지, lint 명령 포함 필수)
4. **Test Result** — 터미널 출력 복붙 (추정/반올림 금지, lint 통과 여부 포함 필수)
5. **Residual Risk** — 닫지 못한 것 (공격자 악용 가능하면 수정 대상이지 Residual이 아님)

## 작성 규칙

- `{{CLAUDE_MD_PATH}}`는 **Write 도구로 전체 교체** — Edit append 절대 금지.
- 증거 섹션은 항상 **1개만** — 새 항목 작성 시 이전 섹션 삭제 후 교체.
- 현재 라운드 항목은 `{{TRIGGER_TAG}}`으로 유지.
- 설계 문서 수정 금지.

## 예시

```markdown
## {{TRIGGER_TAG}} TRACK-1 — 접근 제어 강화

### Claim
resource 엔드포인트 권한을 claim과 일치시키고 직접 테스트 추가.

### Changed Files
**코드:** `src/routes/resource.ts`
**테스트:** `tests/resource.test.ts`

### Test Command
```bash
npx eslint src/routes/resource.ts tests/resource.test.ts
npx vitest run tests/resource.test.ts
```

### Test Result
- eslint: 통과
- 1 file / 8 tests passed

### Residual Risk
- 없음
```
