# CLAUDE.md

Guidance for AI coding sessions working in this repository. Humans should start with
[README.md](README.md) and [CONTRIBUTING.md](CONTRIBUTING.md); this file only adds what a session
needs to work safely and consistently.

## What this is

Chessstack is a self-hosted chess opening-repertoire trainer. It is SvelteKit 2 with Svelte 5
(runes), TypeScript in strict mode, PostgreSQL 17 through Drizzle ORM, and `adapter-node` in a
single Docker image. Stockfish runs in the browser as WebAssembly (`src/lib/engine/`, files in
`engine/`).

Chessstack is developed in a private repository together with the hosted edition at
[chessstack.app](https://chessstack.app), and every release arrives here as one sync pull request
that replaces the code with that release. Changes merged here are carried back to the development
repository by the maintainer; a change made only here is overwritten by the next sync.

The code ships with the hosted edition's optional features switched off: billing (Stripe), email
(Loops) and error tracking (Sentry) stay inactive unless their environment variables are set, and
`EDITION` (`src/lib/server/edition.ts`) defaults to self-hosted.

## Commands

| Task                  | Command                                                                 |
| --------------------- | ----------------------------------------------------------------------- |
| Dev server            | `npm run dev` (needs `DATABASE_URL` in `.env`)                          |
| Type check            | `npm run check`                                                         |
| Format + lint         | `npm run lint` (fix formatting with `npm run format`)                   |
| Unit tests            | `npm test`                                                              |
| Database tests        | `DATABASE_URL=… npm run test:db` (truncates tables; use a throwaway DB) |
| End-to-end (Chromium) | `npm run build`, then `DATABASE_URL=… npm run test:e2e`                 |
| Migration smoke test  | `DATABASE_URL=… node scripts/test-migrations.mjs`                       |

Run `npm run check`, `npm run lint` and `npm test` before every push. Node 24 is what CI and the
Docker image use.

## Layout

- `src/routes/` pages and `src/routes/api/` JSON endpoints (`+server.ts`).
- `src/lib/server/` server-only code; `src/lib/server/api-helpers.ts` has `requireAuth`,
  `requireAdmin` and `parseIntParam`, which every API handler should use.
- `src/lib/server/validation.ts` has `parseBody(request, schema)`: API handlers read JSON bodies
  through it with a zod schema from `src/lib/server/schemas/`, which gets unit tests alongside it.
- `src/lib/components/<area>/` UI, with page state in `*State.svelte.ts` modules (see
  `build/buildState.svelte.ts`). Keep route files thin and move logic into these modules so it can
  be unit-tested.
- `src/lib/db/schema.ts` is the whole schema. The tables at the top (`book_*`, `eco_opening`,
  `chessmont_moves`, `lichess_moves`, `star_players`, `celebrity_moves`, `puzzle`) are seed data
  loaded on first boot: treat them as read-only.
- `e2e/` holds the Playwright specs; `e2e/helpers.ts` registers throwaway users.

## Conventions

- Svelte 5 runes only (`$state`, `$derived`, `$props`); no `export let` or legacy stores in new code.
- Drizzle queries in application code. Raw SQL belongs in migrations and the few advisory-lock
  helpers in `src/lib/db/index.ts`.
- API endpoints return consistent JSON for success and error, and throw SvelteKit `error()` with a
  status for bad input (400), missing auth (401) and forbidden (403).
- Validation bounds live in `src/lib/validation-limits.ts`; reuse them rather than inventing new
  limits.
- Optional integrations (Loops, Stripe, Sentry) switch themselves off when their environment
  variables are unset. New integrations must follow that pattern so self-hosted instances run
  without any third-party account. Document every new variable in `.env.example` and the README.
- Server code logs with `log` from `src/lib/server/log.ts` (one JSON line, tagged with the request
  id), not `console`. Passing an Error as `err` to `log.error` also reports it to Sentry; pass a
  plain `reason` string for expected failures such as a third-party outage.
- Comment the why, not the what. Match the comment density of the surrounding code.
- Record user-visible changes under `## [Unreleased]` in `CHANGELOG.md`.

## Database migrations

Migrations run automatically on startup. They are created in the development repository, which
shares one numbered list with this one, so a pull request here that needs a schema change should
say so rather than add a migration: the maintainer creates it upstream. Never edit a migration
that has shipped.

## Security

The Content-Security-Policy and other security headers are set in `src/hooks.server.ts`; a new
third-party script, font or API host must be added there or it will be blocked. CI runs gitleaks,
npm audit, ESLint security rules, Semgrep and Trivy. Never commit secrets, and report
vulnerabilities as described in [SECURITY.md](SECURITY.md).

## Pull requests

Keep each PR to one change. Describe it with a "Before:" and an "After:" paragraph, then a short
"How". CI must be green, including the end-to-end job, before review.
