# Code Quality Principles

> Principles applied during audit. Add/modify items to match your team's policy.

## Design Principles (structural regression detection)

| Principle | Violation Signal | Audit Verdict |
|-----------|-----------------|---------------|
| **SOLID** | Multiple responsibilities in single file, unseparated interfaces | `principle-drift` |
| **YAGNI** | Features not in current requirements | `principle-drift` |
| **DRY** | Same logic copied to 2+ locations | `principle-drift` |
| **KISS** | Unnecessary abstraction, over-engineering | `principle-drift` |
| **LoD** | Deep chaining (`a.b.c.d.method()`) | `principle-drift` |

## Security Principles (OWASP TOP 10)

| Item | Check | Audit Verdict |
|------|-------|---------------|
| **A01 Broken Access Control** | Scope guard on all endpoints | `security-drift` |
| **A02 Cryptographic Failures** | Sensitive data stored/transmitted in plaintext | `security-drift` |
| **A03 Injection** | SQL/NoSQL/OS command injection defense | `security-drift` |
| **A04 Insecure Design** | Business logic level security gaps | `security-drift` |
| **A05 Security Misconfiguration** | Default credentials, unnecessary features enabled | `security-drift` |
| **A06 Vulnerable Components** | Dependencies with known vulnerabilities | `security-drift` |
| **A07 Authentication Failures** | Session management, token validation gaps | `security-drift` |
| **A08 Integrity Failures** | Unsigned verification, untrusted sources | `security-drift` |
| **A09 Logging Gaps** | Missing security event logging | `security-drift` |
| **A10 SSRF** | Unvalidated user-supplied URLs | `security-drift` |

## Attacker Perspective Verification

- Start from "How can this code be broken?"
- Enumerate vectors: wdir manipulation, cross-team direct access, session key guessing, direct external API calls
- If vulnerability found → `security-drift [major]`
