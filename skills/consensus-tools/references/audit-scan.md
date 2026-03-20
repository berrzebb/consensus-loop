# audit_scan

Zero-token pattern scanner. Detects anti-patterns without LLM reasoning — pure regex matching via `rg` (ripgrep).

## When to Use

- Pre-commit quality check — find `as any`, `@ts-ignore`, `console.log` before submission
- Evidence preparation — scan for issues that audit will flag
- Code review — quick sweep for common anti-patterns

## Parameters

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `--pattern` | No | `all` | Scan category: `all`, `type-safety`, `hardcoded`, `console` |
| `--path` | No | `src/` | Target directory to scan |

## Categories

| Category | What it finds |
|----------|--------------|
| `type-safety` | `as any`, `@ts-ignore`, `@ts-expect-error` |
| `hardcoded` | `localhost`, `127.0.0.1`, `redis://`, port numbers |
| `empty-catch` | `catch {}` blocks with no error handling |
| `todo` | `TODO`, `FIXME`, `HACK` comments |
| `all` | All of the above |

## Examples

```bash
# Full scan
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs audit_scan

# Type-safety issues only
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs audit_scan --pattern type-safety

# Scan specific directory
node ${CLAUDE_PLUGIN_ROOT}/scripts/tool-runner.mjs audit_scan --pattern hardcoded --path src/config/
```

## Output Format

```
=== Type Safety Issues (as any, @ts-ignore, @ts-expect-error) ===
src/utils/parser.ts:45: const data = response as any
src/api/handler.ts:12: // @ts-ignore

=== Hardcoded Values (localhost, ports, Redis URLs) ===
  (none found)
```

## Note

Requires `rg` (ripgrep) to be installed and available in PATH. Falls back gracefully if not found.
