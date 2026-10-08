# Contributing to Chessstack

Thank you for your interest in contributing! This document covers how to set up
a development environment, the code style expected, and how to submit changes.

---

## Table of Contents

- [Setting Up a Dev Environment](#setting-up-a-dev-environment)
- [Running the App Locally](#running-the-app-locally)
- [Running Tests](#running-tests)
- [Database Migrations](#database-migrations)
- [Code Style](#code-style)
- [Submitting a Pull Request](#submitting-a-pull-request)

---

## Setting Up a Dev Environment

### Requirements

- [Node.js](https://nodejs.org/) 24 (the version used in CI and Docker; 22.12+ also works)
- [Docker](https://docs.docker.com/get-docker/) and Docker Compose (for PostgreSQL)
- A code editor — [VS Code](https://code.visualstudio.com/) is recommended

### Steps

```bash
# Clone the repository
git clone https://github.com/PvtTwinkle/chessstack.git
cd chessstack

# Install dependencies
npm install
```

---

## Running the App Locally

There are two ways to run the app during development.

### Option A — Dev server with local PostgreSQL

This is the fastest way to work on the UI. Stockfish runs in the browser, so
there is no engine to install.

```bash
cp .env.example .env
# Edit .env: set POSTGRES_PASSWORD, put the same password in DATABASE_URL,
# and set ORIGIN=http://localhost:5173

docker compose up -d postgres   # or use your own PostgreSQL 17
npm run dev
```

The app starts at `http://localhost:5173` and creates its tables on startup.
`npm run dev` reads `.env` automatically. Sign in with the admin account it
creates on first run (`DEFAULT_USERNAME` / `DEFAULT_PASSWORD`, default `admin` / `changeme`).

**Reference data in dev.** The Masters, Players and Stars tabs and the Puzzles
page need the reference datasets, which are only baked into the Docker image.
To load them into a dev database, download the dumps from this repository's
[`data-v1.0` release](https://github.com/pvttwinkle/chessstack/releases/tag/data-v1.0)
into a folder, check them by running `sha256sum -c <repo>/seed-checksums/data-v1.0.sha256` in that
folder, and set `SEED_DATA_DIR` to its **absolute** path. They load on the next start (this
takes several minutes and needs `psql` and `gunzip` on your machine).

### Option B — Full stack with Docker

This runs the complete stack exactly as it runs in production.

```bash
docker compose up -d --build
```

The app starts at `http://localhost:3000`.

To see live logs:

```bash
docker compose logs -f app
```

### Useful Dev Commands

```bash
npm run check      # TypeScript type check
npm run lint       # Check formatting and linting
npm run format     # Auto-format all files
npm run build      # Production build
```

---

## Running Tests

There are three suites. CI runs all of them on every pull request.

```bash
# Unit tests — pure logic, no database needed
npm test

# Unit tests with a coverage report (open coverage/index.html)
npm run test:coverage

# Database integration tests — needs a DISPOSABLE PostgreSQL database
# (migrations run automatically; tables are truncated between tests)
DATABASE_URL=postgresql://chessstack:chessstack@localhost:5432/chessstack_test npm run test:db

# End-to-end smoke test — builds on `npm run build`, starts the app and
# drives it in Chromium (register → build a line → drill it)
npx playwright install chromium   # first time only
DATABASE_URL=postgresql://chessstack:chessstack@localhost:5432/chessstack_test npm run test:e2e
```

The end-to-end suite registers about a dozen accounts per run, and registration is
rate-limited to 20 per hour per IP, so give each run a freshly created database.

Unit tests live next to the code as `*.test.ts`, database tests as
`*.db.test.ts`, and browser tests in `e2e/`. Tests for Svelte runes modules
(`*.svelte.ts`) are named `*.svelte.test.ts`: they compile for the browser so
`$effect` runs (wrap the module in `$effect.root` and call `flushSync()`). Please add or update tests
for any change to billing, auth, scheduling or PGN handling.

---

## Database Migrations

Migrations are plain SQL files in `drizzle/migrations/`, applied automatically
in order on startup. To change the schema:

1. Update the table definitions in `src/lib/db/schema.ts`.
2. Run `npx drizzle-kit generate`. It writes the next numbered SQL file, a
   snapshot and a journal entry in `drizzle/migrations/`; read the SQL, rename
   the file to something descriptive if you like (keep the `tag` in
   `meta/_journal.json` in step), and commit all three. CI fails if
   `schema.ts` and the migrations disagree.
3. Run `node scripts/test-migrations.mjs` against an empty database and the
   database tests (`npm run test:db`), which apply all migrations first.

Migrations must be safe on a live database with existing data. Never edit a
migration that has already been deployed: add a new one instead.

---

## Code Style

- **TypeScript everywhere** — no plain `.js` files in `src/`
- **Explicit over clever** — readable code is better than clever code
- **Small, focused components** — one job per Svelte component
- **Comment the why** — add comments when the reasoning is not obvious from
  reading the code
- **No raw SQL in application code** — use Drizzle ORM queries; raw SQL belongs
  only in migration files
- **Consistent JSON responses** — all API endpoints return the same shape of
  response object for success and error cases

Prettier and ESLint are configured in the repo. Run `npm run format` before
committing. The CI check will fail if formatting is off.

---

## Contributor License Agreement

Before your pull request can be merged, you must agree to the
[Contributor License Agreement](CLA.md).

No separate action is needed — opening a pull request constitutes your agreement.
The short version: you confirm you have the right to submit your code, and you
grant the project owner the right to use it under any license, including for a
hosted or commercial version of the software. You keep your own copyright.

---

## Submitting a Pull Request

1. Fork the repo and create a feature branch from `main`:

   ```bash
   git checkout -b feat/short-description
   ```

2. Keep changes focused — one feature or fix per PR. Smaller PRs are easier to
   review and merge.

3. Run checks before pushing:

   ```bash
   npm run check
   npm run lint
   npm test
   ```

4. Push and open a pull request against `main`. Chessstack is developed alongside the hosted
   edition at chessstack.app, and each release arrives here as one sync pull request; the
   maintainer carries merged contributions over so the next release keeps them.

5. In the PR description, explain:
   - What you changed and why
   - How you tested it (steps to reproduce, screenshots if UI-related)

6. CI runs automatically: type check, formatting and lint, unit tests, build, migration smoke test,
   database and end-to-end tests, and the security scans must all pass before
   the PR can be merged.

---

## Reporting Bugs and Requesting Features

Open a [GitHub Issue](https://github.com/PvtTwinkle/chessstack/issues) for bug
reports, feature requests, or general questions.

Please report security vulnerabilities privately as described in
[SECURITY.md](SECURITY.md), not in a public issue.

When reporting a bug, include:

- Steps to reproduce the issue
- Expected vs actual behavior
- Browser and OS (if UI-related)
- Docker version and deployment method (if infrastructure-related)
