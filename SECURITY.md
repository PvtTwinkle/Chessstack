# Security

## Reporting a Vulnerability

**Please do not report security issues in public GitHub issues.**

Report them privately instead by emailing **support@chessstack.app** with "Security" in the
subject line.

Include the steps to reproduce, the affected URL or code, and the impact you expect. You will
get an acknowledgement as soon as possible, and you are welcome to be credited once the issue is
fixed.

Please do not access other users' data, degrade the service for others, or run automated
scanners against chessstack.app while researching.

---

## Application Security

**Accounts and sessions**

- Passwords are hashed with bcrypt and must be at least 12 characters with mixed character types
- Sessions are random tokens in `HttpOnly`, `SameSite=Lax` cookies, marked `Secure` when `ORIGIN`
  is `https://`, and expire after 14 days. Disabling an account ends its sessions immediately.
- Email verification and password reset links carry 256-bit random tokens. Only their SHA-256
  hash is stored. They are single-use (redeemed atomically) and expire after 24 hours and
  1 hour respectively.
- Login, registration and email requests are rate-limited per client IP. Expensive API endpoints
  are rate-limited per user.

**Requests and data**

- Every query is scoped to the `user_id` of the authenticated session. There is no cross-user
  data access, and admin routes are restricted to the admin role.
- SvelteKit's origin check (`ORIGIN`) protects form submissions against CSRF.
- Responses carry a Content Security Policy, HSTS, `X-Frame-Options`,
  `X-Content-Type-Options`, `Referrer-Policy` and `Permissions-Policy` headers.
- Error logs never contain request bodies or query strings.

**Billing**

- Stripe webhooks are accepted only with a valid Stripe signature.
- Card details never reach this application; checkout and billing management happen on
  Stripe-hosted pages.

**Infrastructure**

- The Docker image runs as an unprivileged `node` user.
- Outbound connections go only to PostgreSQL, Stripe and Loops (when configured), and to
  Lichess / Chess.com for game imports. The CSP also allows Cloudflare Web Analytics, which
  Cloudflare injects when enabled for the domain.

---

## Automated Checks

### CI (every pull request and push to `main`)

| Check                   | Purpose                                                                     |
| ----------------------- | --------------------------------------------------------------------------- |
| Gitleaks                | Secrets in the Git history                                                  |
| npm audit               | Known vulnerabilities in all dependencies (fails on high or critical)       |
| ESLint security plugins | Node.js security antipatterns and DOM injection sinks                       |
| License checker         | Dependency licenses must be on the approved list (below)                    |
| Semgrep                 | SAST: injection, path traversal and similar patterns                        |
| Trivy (config)          | Dockerfile misconfigurations                                                |
| Trivy (image)           | OS and library vulnerabilities in the built Docker image                    |
| Tests                   | Unit, database integration and end-to-end tests, including auth and billing |

GitHub Actions are pinned to full commit SHAs, and workflows run with read-only permissions.
[Dependabot](.github/dependabot.yml) opens weekly update PRs for npm packages, GitHub Actions and
Docker base images. Dependabot alerts are on; automatic security update PRs are off, so
vulnerable dependencies are flagged and then fixed by hand or in the weekly updates.

### Pre-push hooks (optional, local)

[`.pre-commit-config.yaml`](.pre-commit-config.yaml) runs Gitleaks, npm audit, the ESLint
security rules, the license check, Semgrep and the Trivy config scan before every `git push`:

```bash
pip install pre-commit
pre-commit install --hook-type pre-push
```

Semgrep and Trivy must be installed locally for those two hooks.

### Approved Dependency Licenses

MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, MPL-2.0, GPL-3.0-or-later, Python-2.0,
Unlicense, CC0-1.0, CC-BY-3.0, CC-BY-4.0 and BlueOak-1.0.0.
