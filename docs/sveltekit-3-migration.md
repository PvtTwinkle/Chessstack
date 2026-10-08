# SvelteKit 3 Migration Plan

Status: **deferred**. SvelteKit 3.0.0 and adapter-node 6.0.0 were released on 2026-10-01. This
project stays on SvelteKit 2.70.x (still supported) until 3.x has had a few patch releases.
Dependabot is configured to skip the major bump (`.github/dependabot.yml`), so the upgrade
happens as a deliberate change, on its own branch.

Official guide: <https://svelte.dev/docs/kit/migrating-to-sveltekit-3>. Most mechanical
changes can be done with:

```bash
npx sv migrate sveltekit-3
```

## Prerequisites

| Requirement                      | Current state                  |
| -------------------------------- | ------------------------------ |
| Node ≥ 22.17                     | Done: Node 24 in CI and Docker |
| TypeScript 6                     | On 5.9, upgrade with SvelteKit |
| Svelte ≥ 5.57.1                  | Done                           |
| Vite ≥ 8.0.12                    | Done                           |
| `@sveltejs/vite-plugin-svelte` 7 | Done                           |

## The one change that needs a decision: the site origin

adapter-node 6 **removes the `ORIGIN` environment variable**. It now determines the origin
used for CSRF checks on form submissions like this:

1. `paths.origin` from the Vite config, if set. This is **fixed at build time**.
2. Otherwise from the request: `PROTOCOL_HEADER` (if set) or **`https` by default**, plus
   `HOST_HEADER` or the `Host` header.

Consequences for this app:

- **Production behind an HTTPS proxy keeps working** without configuration, as long as the
  proxy passes the public `Host` header. Optionally set `PROTOCOL_HEADER=x-forwarded-proto`
  and `HOST_HEADER=x-forwarded-host` if the proxy rewrites `Host`.
- **Plain-`http` setups break** (local `docker compose`, the CI end-to-end test, any http-only
  self-test): the origin is assumed to be `https://…`, so every form POST (login, register,
  …) is rejected with "Cross-site POST form submissions are forbidden". These setups need
  `paths.origin` baked in at build time, e.g.:

  ```js
  // vite.config.ts — only for builds; the dev server derives the origin itself
  sveltekit({ adapter: adapter(), paths: { origin: process.env.ORIGIN } });
  ```

  together with `ARG ORIGIN` in the Dockerfile builder stage and `ORIGIN=http://localhost:4173`
  for the CI build that the e2e test uses.

The app's **own** uses of `process.env.ORIGIN` are unaffected and keep it as a runtime
variable: secure-cookie detection (`src/lib/auth/index.ts`), email links
(`email-verification.ts`, `password-reset.ts`), Stripe redirect URLs (`billing/checkout`,
`billing/portal`) and the proxy warning in `hooks.server.ts`.

## Code changes (scope measured on 2026-10-02)

| Change                                                              | Scope in this codebase                                        |
| ------------------------------------------------------------------- | ------------------------------------------------------------- |
| `svelte.config.js` → options passed to `sveltekit()` in Vite config | 1 file (adapter + mdsvex preprocess)                          |
| `$lib` → `#lib` (+ `imports` in package.json, explicit extensions)  | 135 files (codemod)                                           |
| `resolveRoute` removed → `resolve` (paths lose the leading `/`)     | 6 uses in 3 files                                             |
| `invalidateAll` deprecated → `refreshAll`                           | 76 uses in 13 files                                           |
| `$app/stores` removed → `$app/state`                                | 5 files                                                       |
| `json()` deprecated (still works)                                   | 140 calls; can be migrated later                              |
| `error(status, {…})` object form removed                            | check during migration                                        |
| `handleError` now receives expected errors too                      | `hooks.server.ts` logs every error; filter 4xx to avoid noise |
| Static assets: `GET`/`HEAD` only, list fixed at build time          | no runtime-added static files, no impact                      |

## Verification

The test suites added in October 2026 cover the risky paths: run `npm test`, `npm run test:db`
and `npm run test:e2e` (the e2e test exercises register/login form actions, which is exactly
what an origin misconfiguration breaks). Before deploying, also check a form submission on a
staging deployment behind the real proxy.
