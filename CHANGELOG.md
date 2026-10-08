# Changelog

All notable changes to Chessstack are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

- `EDITION` setting: `cloud` for chessstack.app, anything else (the default) for a self-hosted install. Self-hosted instances have no plan limits, send logged-out visitors to the login form instead of the public website, make the email optional at sign-up, hide billing and referrals, and create a default admin from `DEFAULT_USERNAME` / `DEFAULT_PASSWORD` on first run

### Fixed

- Databases created by the self-hosted edition (v1.0.0 to v1.3.1) can now be upgraded to this version: on startup Chessstack recognises their migration history, which used different numbering, and applies the migrations they are missing instead of failing to start
- The engine no longer reports "Stockfish engine is not available" when its search threads take a few seconds to start, which happened in Firefox: Chessstack now waits for them as part of loading the engine
- The in-browser engine's files are served without a login check, so the engine no longer fails to load when the browser doesn't send the session cookie with the engine's own requests
- Engine suggestions and analysis now work in Firefox: when the multi-threaded engine can't start, Chessstack now switches to the single-threaded one (and remembers that for next time) instead of reporting the engine as unavailable

### Changed

- The Opening Trainer scores the final position of a game with the browser engine too, and the server uses that score for the result and the rating change
- Review's game analysis (the accuracy colours for every move and the evaluations of a deviation and its repertoire move) now also runs in the browser engine
- Engine suggestions on the Build and Prep pages (and in Review's issue picker) now run Stockfish 19 in your browser instead of on the server. It uses several CPU threads where the browser allows it and a single thread elsewhere, and downloads about 1.7 MB once. Every page now sends cross-origin isolation headers, which the multi-threaded engine needs
- Engine analysis is no longer limited by plan: free accounts can now set Stockfish depth anywhere from 15 to 30, the same as paid ones. The paid plan still unlocks unlimited repertoires

### Removed

- The server no longer runs Stockfish: the Docker image drops Debian's Stockfish package, and `STOCKFISH_BIN` and `STOCKFISH_MAX_CONCURRENT` are gone. The opening book lookup moved from `/api/stockfish` to `/api/book`, and its rate limit is now `RATE_LIMIT_BOOK` (was `RATE_LIMIT_STOCKFISH`)
- `scripts/lichess-recover.py`, which only applied to an older version of the Lichess import and dropped the whole players table as its first step. A crashed import resumes with `lichess-import.py --resume`, or `--finalize-only --start-bracket N` if it stopped during the final merge
- Three empty placeholder modules (`src/lib/eco/`, `src/lib/fsrs/`, `src/lib/lichess/`) left over from early scaffolding, and the unused `@types/bcryptjs` package (bcryptjs ships its own types)

### Security

- The Docker build checks each downloaded reference-data dump against a SHA-256 checksum committed in `seed-checksums/`, and fails if a dump is missing or has changed, so a replaced release file can't reach the database. A failed download now also stops the build instead of only the last one
- The Docker image now applies Debian security updates at build time, picking up the fix for `libpcre2-8-0` CVE-2026-103111 that the base image did not yet include
- Cleared the remaining dependency advisories by forcing patched versions of two transitive packages: `cookie` 0.7.2 under SvelteKit (GHSA-pxg6-pf52-xh8x) and `esbuild` 0.25 under drizzle-kit's loader (GHSA-67mh-4wv8-2f99). Neither was exploitable here: cookie names, paths and domains are all constants, and the old esbuild was only used by the drizzle-kit CLI, never as a dev server

---

## [1.4.0] -- 2026-10-03

This release was not published separately in this repository; its changes arrive with the next
release.

### Security

- Email verification and password reset tokens are now stored as SHA-256 hashes and looked up with a single indexed query; previously every request bcrypt-compared against all outstanding tokens, an unauthenticated CPU exhaustion vector. Outstanding links issued before this change stop working (users request a new one)
- Email verification and password reset tokens are redeemed atomically, so one link can no longer be used twice by concurrent requests
- Patched all high-severity dependency advisories (SvelteKit 2.70.3, Svelte 5.57.1, Vite 8.3.2, devalue 5.9.4)
- CI's npm audit now covers devDependencies, since SvelteKit, Svelte and devalue are bundled into the server despite being devDependencies
- GitHub Actions pinned to commit SHAs and upgraded to current versions; workflows run with read-only permissions
- Startup warning when `ORIGIN` is `https://` but `ADDRESS_HEADER` is unset (behind a proxy all clients would share one login rate limit)
- Vulnerabilities are now reported privately (SECURITY.md) instead of through public GitHub issues

### Added

- The server logs at startup whether Sentry reporting is on for the server and the browser, the build logs whether source maps will be uploaded, and admins can trigger a test error at `/api/admin/sentry-test`
- Optional error tracking with Sentry for server and browser errors, switched on by `SENTRY_DSN` / `PUBLIC_SENTRY_DSN` and off by default. Events carry no cookies, IPs, request bodies, query strings or emails. Source maps are uploaded at build time when `SENTRY_AUTH_TOKEN` is set
- Every request gets an id, returned in the `X-Request-Id` header and shown on the error page for unexpected errors, so a bug report can be matched to the logs and the Sentry event
- Reusable `<Seo>` head component (title, description, canonical, Open Graph, X cards, JSON-LD) and `$lib/seo` helpers, ready for new public sections such as opening guides
- Static favicons (`/favicon.svg`, `/favicon-96x96.png`, `/favicon.ico`) that search engines can crawl
- End-to-end tests for Review (6) and Drill (5) plus account deletion, and unit tests for review evaluation, drill line logic and admin helpers
- Test suites: Vitest unit tests, database integration tests (rate limiting, tokens, referrals, checkout, Stripe webhook) and a Playwright end-to-end smoke test, all run in CI
- `GET /api/health/ready` readiness endpoint that checks the database (HTTP 503 when unreachable) for uptime monitoring
- Dependabot for npm packages, GitHub Actions and Docker base images
- Opening trainer mode: practice openings against a computer that plays moves weighted by real game statistics, with Elo rating tracking
- Saved starting positions for the opening trainer so you can jump straight into specific lines
- Opening trainer step added to the onboarding tutorial

### Changed

- Every JSON API endpoint validates its request body against a shared schema, so malformed or out-of-range input always gets a 400 with a message naming the field
- Server logs are now one JSON object per line with a timestamp, level and request id, plus one line per request (method, path, status, duration). Set `LOG_FORMAT=text` for the old human-readable style
- Manrope is self-hosted instead of loaded from Google Fonts; the Content-Security-Policy no longer allows Google Fonts
- Large pages split into focused components and tested modules: Settings (2095 → 1512 lines), Admin (1132 → 306), Review (3419 → 2232) and Drill (2733 → 2168), with cloud-only parts of Settings and Admin in their own components; verified with pixel-identical before/after screenshots
- Runtime upgraded to Node.js 24 LTS (Docker image and CI); `@types/node` matches at v24
- Stripe SDK upgraded from 20.4.1 to 22.6.2 (pinned Stripe API version 2026-08-26.dahlia)
- SvelteKit 3 upgrade deferred until 3.x matures; migration plan in `docs/sveltekit-3-migration.md`
- Replaced the deprecated Semgrep GitHub Action with the official Semgrep container
- Updated dependencies: Vite 8, ESLint 10, Svelte 5.55, Drizzle 0.45.2

### Fixed

- PGN import no longer saves the rest of a line whose move you turned down at a conflict, which left stray moves in the repertoire that couldn't be reached from the start
- Unknown URLs return 404 instead of redirecting logged-out visitors to the landing page (soft 404s in search)
- Drill depth sections (Foundations / Mainlines / Deep Lines) now count cards by their real move number. Since positions were normalised to 4-field FENs (no move counters), every card was counted as move 1, so Mainlines and Deep Lines were always empty
- `npm run dev` now loads `.env`; previously the documented local setup failed with "DATABASE_URL ... is required but not set"
- Seed data restore no longer goes through a shell, so database passwords containing `$`, quotes or backticks work
- A corrupt or truncated seed download is now detected and retried on the next start, instead of possibly leaving a half-loaded table that was never reloaded
- Rate-limit documentation corrected to the actual 5-minute window and defaults
- Fixed build mode locking up with 429 errors by increasing rate limits (120 req/5 min instead of 60 req/15 min) and adding 150ms debounce to all position-change API calls
- Rate limit errors now show "Too many requests" instead of misleading "database unavailable" messages
- Rate limit detection now works consistently across all candidate tabs (players, stars), not just book and masters
- Review move list no longer expands the layout between the board and sidebar

---

## [1.3.1] -- 2026-04-30

### Added

- Contributor License Agreement (CLA) granting Chessstack LLC the right to use contributions under any license, including proprietary and commercial licenses

### Changed

- Data export script now includes the players (Lichess) database in the exported release assets instead of creating an empty placeholder
- Upgraded Vite to 8.0.10, patching two CVEs (path traversal and dev-server WebSocket RCE)
- Upgraded SvelteKit to 2.58.0, Svelte to 5.55.5, ESLint to 10.2.1, Prettier to 3.8.3, and other minor dependency bumps

---

## [1.3.0] -- 2026-04-02

### Added

- Opening Trainer mode -- practice openings against a computer that plays moves weighted by real game statistics from the Lichess open database or masters database
- Computer opponent selects moves with probability proportional to how often each move is played at the chosen rating bracket
- Rating bracket selector with human-readable labels (e.g. "1401-1600"), defaulting to the bracket matching the user's trainer rating
- Per-user trainer Elo rating that updates after rated sessions, with difficulty scaling based on the selected rating bracket relative to your rating
- Configurable depth limit (full moves), with training always stopping on database exhaustion, game over, or manual stop
- Stockfish evaluation of the final position shown on the end screen with rating change breakdown
- Review Game button sends the completed PGN to the review page with full move history, player names, date, rating, and result headers
- Analyze on Lichess link on the end screen to open the final position in the Lichess analysis explorer
- Save and reuse custom starting positions with lead-in move tracking so PGNs always start from move 1
- Repertoire start position support with automatic path reconstruction from the move tree
- First-visit prompt to set an initial trainer rating, also editable from the Settings page
- Rated/unrated session toggle
- Tutorial now includes an Opening Trainer step after Drill, explaining the feature and its rating system

### Fixed

- Game review move list no longer pushes the board and sidebar apart as the game gets longer

### Changed

- Updated all dependencies to latest compatible versions: Svelte 5.55, Vite 8, ESLint 10, Drizzle ORM 0.45.2, and others
- Lichess import script supports cumulative multi-month imports with separate retention and dump thresholds (`--min-games` and `--min-dump-games`)
- Recovery script accepts `--min-games` argument instead of using a hardcoded value

### Known Issues

- Opening Trainer sessions tend to run out of database moves earlier than expected because only one month of Lichess game data is currently loaded, filtered to positions reached at least 100 times. Work is in progress to import at least a year of data and lower the threshold to 50 games.

---

## [1.2.2] — 2026-03-28

### Changed

- Dropped arm64 from the release Docker image to fix builds timing out under QEMU emulation (amd64 only for now)
- Improved mobile responsive layout across all pages with standardized breakpoints and small-phone support
- Dashboard switches to single-column grid on phones under 480px
- Settings page now has full responsive support (touch targets, stacked forms, iOS zoom prevention)
- Admin user cards stack earlier (at tablet width) for better readability
- Header compacts in landscape orientation on phones (shorter bar, hidden brand text)
- Fullscreen modals now trigger at 479px instead of 559px, keeping centered dialogs on larger phones
- Expanded the tutorial from 5 steps to 9, covering all major pages including Puzzles, Review, Prep, and Dashboard
- Tutorial now highlights more features per page: all five suggestion tabs in Build, Explore mode, Cards/Lines drill modes, Blindfold mode, and PGN import/export
- Rewrote README with grouped feature sections, screenshots, tech stack table, and all features through v1.2.1
- Updated THIRD-PARTY-NOTICES with Lichess Open Database and Star Player Games (PGN Mentor, Lichess API, Chess.com API)

### Fixed

- Resolved security lint warning in PGN header parser by using static regex patterns
- Fixed hardcoded goal input width on dashboard that could overflow on small screens
- Fixed prep detail panel overflowing on narrow phones due to min-width: 250px constraint
- Added 44px touch targets to drill grading buttons, filter tabs, puzzle checkboxes, and admin action buttons

---

## [1.2.1] — 2026-03-28

### Added

- **Players move database** — Lichess open database seeded on first boot, showing the most commonly played moves per rating bracket

---

## [1.2.0] — 2026-03-27

### Added

- **Tournament Prep Mode** — new /prep page for opponent-specific preparation
  - Download an opponent's games from Lichess or Chess.com, analyze tendencies, and build targeted responses
  - Alternating turn-based UI: on the opponent's turn see their most-played moves with W/D/L stats; on your turn pick a response using Book/Masters/Stars/Players/Engine tabs plus data on what others played against them
  - Gap detection walks your prep tree and highlights positions where you have no prepared response, prioritized by how often the opponent reaches them
  - Animated "Next uncovered position" button replays the line move-by-move to the highest-priority gap
  - Coverage dashboard shows reachable positions with green/yellow/red breakdown
  - Move tree view (same collapsible tree from Build mode) shows the full prep structure
  - Min-games filter to hide rare moves, and per-move exclusion with restore
  - Export prep as a new repertoire with FSRS drill cards, or add prep moves to an existing repertoire with conflict resolution
  - Configurable max games per fetch (50–5000), time window selector on refresh, and chunked server uploads for large datasets
  - Refresh confirmation to prevent accidental data replacement
  - One-move-per-position enforcement (matching Build mode) — conflict banner warns when a different move already exists
  - Smart worker filter preserves leaf moves at established positions so you can see the end of lines
  - Lichess game fetch prioritizes most recent games (dateDesc) so capped fetches get the latest data

### Changed

- **Light theme redesigned** — replaced heavy blue-grey backgrounds with a proper cool-neutral palette inspired by GitHub; cards are now white on a light off-white page with clear layering, tuned accent/eval/semantic colors, and softer border+shadow depth

### Fixed

- Black prep export was including wrong opponent moves, causing broken drill cards — now correctly filters by expected opponent color
- "Next uncovered position" was stuck at the first move because gap detection only walked opponent moves — now follows prep moves and coverage deeper into the tree
- Dashboard stats (coverage %, position count) were counting unreachable positions — now consistent with gap detection by only counting positions reachable through your prep
- Suggestions in "Played against your opponent" could bypass the one-move-per-position rule — now routed through the conflict check
- Large opponent datasets (2700+ games) failed on merge due to PostgreSQL parameter limits and SvelteKit body size — chunked into 1000-move batches sent as separate requests
- Duplicate `{#each}` keys in move panels caused page crashes after export — switched to index-based keys

### Removed

- Trivy filesystem scan from pre-push hooks and CI — redundant with npm audit and the Docker image scan, and caused SSH timeouts during database downloads

### Changed

- Removed pricing section from the landing page — pricing is now only shown in-app under settings
- Renamed hero CTA from "Get Started Free" to "Get Started"
- FSRS config loading extracted into a shared helper — eliminates duplicated query logic across three API routes
- FSRS instances are now cached by config key, avoiding redundant instantiation on repeated calls
- Interval label computation calls `f.repeat()` once per card instead of three times (one per rating)
- WDL move rows in Build mode deduplicated into a shared Svelte snippet used by Masters, Stars, and Players tabs
- Drill grade and fail-card API routes now load the card and FSRS config in parallel
- Dockerfile no longer creates an empty placeholder for the Lichess dump file
- PostgreSQL port exposed by default in docker-compose for easier local access
- Replaced recursive per-move deletion with a single recursive CTE query + batch deletes — reduces N+1 DB roundtrips to 3 queries regardless of subtree size
- Replaced `ORDER BY RANDOM()` puzzle selection with count + random offset — avoids full-table sort on large puzzle tables
- Extracted `requireAuth()`, `requireAdmin()`, and `parseIntParam()` helpers into `api-helpers.ts` — eliminates boilerplate across 37 API routes
- Centralised validation limits (`USERNAME_MIN/MAX_LENGTH`, `FEN_MAX_LENGTH`, `NOTES_MAX_LENGTH`, `MAX_CARDS_REVIEWED`) into `validation-limits.ts`
- Migrated 3 routes from hardcoded FEN length checks to the shared `sanitizeFen()` helper
- Named inline magic numbers: `SESSION_CLEANUP_INTERVAL_MS` in hooks, `STARTUP_DELAY_MS` in import scheduler
- Added `upgrade-insecure-requests` to Content-Security-Policy header
- Replaced app logo with new professional brand assets (pawn-on-stacked-layers icon) across all pages
- Logo displays on a theme-aware rounded background (#f0efed in dark mode, #e4e2de in light mode)
- Added `--color-logo-bg` design token for logo background color
- Privacy Policy — replaced placeholder with formal legal template (Chessstack LLC), merged in app-specific details (chess data, third-party services, cookie specs, security measures)
- Terms of Use — replaced placeholder with formal legal template (Chessstack LLC, Florida governing law), added IP rights, user representations, indemnification, and liability sections
- Stronger password requirements — minimum 12 characters with uppercase, lowercase, number, and special character (enforced on registration, password change, and admin reset)

### Added

- **Stars tab** in Build mode — see what moves famous players like Magnus Carlsen, Bobby Fischer, or GothamChess played at any position, with win/draw/loss stats
- Player dropdown in the Stars tab groups players by category: Chess Legends, Modern Super-GMs, Streamers & YouTubers, and Meme
- Import scripts for adding star players from PGN files (`celebrity-import.py`) or downloading games from Lichess/Chess.com APIs (`celebrity-download.py`)
- Celebrity move data ships in the Docker image and auto-loads on first boot, just like the masters and puzzle databases
- **Drill scheduling settings** — configure desired retention (70–97%), maximum review interval (30–3650 days), and relearning delay (1–60 min) from the Settings page
- **Interval labels on drill grade buttons** — each button now shows how long until the card reappears (e.g. "Forgot · 10 min", "Easy · 7 days")
- Link to the FSRS algorithm wiki in Settings for users who want to understand how scheduling works
- **Players tab** in Build mode — shows the most popular moves played at each position, filtered by rating bracket (0–1000 through 2201–2400), sourced from the Lichess Open Database
- Import script for Lichess game data — streams .pgn.zst files, supports incremental month-by-month imports, and exports a pg_dump for Docker distribution
- OpenGraph meta tags (og:image, og:title, og:type) on the landing page for social sharing previews
- Apple touch icon and theme-color meta tag in app.html
- New logo assets: `logo-icon.svg` (favicon), `logo-icon-white.svg` (white variant), `og-image.png`, `apple-touch-icon.png`
- Loops contact management — self-registered users are automatically added as contacts in Loops with their username and email
- Changing email in settings updates the corresponding Loops contact
- Admin can manually verify users from the admin panel (new "Verify" button next to unverified badge)
- Verify-email page shows immediate error when the verification email fails to send
- Verify-email page shows a reminder after 2 minutes if the email hasn't arrived
- Support email (support@chessstack.app) — mailto links on email verification, forgot-password, reset-password, terms, privacy, landing footer, and settings pages
- Custom error page — styled 404/403/500 page with friendly messages and a link back to the dashboard
- Password reset via Loops — "Forgot password?" link on login page sends a reset email; tokens expire after 1 hour, single-use; all sessions invalidated on reset
- New env var: `LOOPS_PASSWORD_RESET_ID` (requires a separate Loops transactional email template)
- Email verification via Loops — new users must verify their email before accessing the app; admin-created users verify on first login
- Verify-email page with resend button and rate limiting (3 per 15 min)
- Graceful degradation — email verification is skipped when `LOOPS_API_KEY` is not set
- "Unverified" badge on admin user cards for users who haven't verified their email
- New env vars: `LOOPS_API_KEY`, `LOOPS_TRANSACTIONAL_ID`
- Clickable upgrade links — "Upgrade" text in manage repertoires and Stockfish depth settings now links directly to the subscription section
- Self-host recommendation in Settings — free-tier users see a callout with a link to the GitHub self-hosting guide
- Required email for all new accounts — registration and admin user creation now require a unique email address
- Email management in Settings — users can view and update their email from the Account section
- Missing-email banner — existing users without an email see a persistent prompt linking to Settings
- Self-service account deletion — users can delete their own account from Settings with password confirmation; cancels Stripe subscription, cascade-deletes all data, and redirects to landing page
- Admin user search — filter users by username or email with a debounced search bar
- Tier and subscription badges on admin user cards — shows Free/Paid tier, subscription status (Active, Past Due, Canceled), and email
- Admin gift subscriptions — admins can gift paid access for 1 month, 1 year, or lifetime without Stripe; gifts are immune to Stripe webhook downgrades
- Gift status on the Settings page — gifted users see "Gift" as their plan with expiry info instead of "Monthly"; visible even when Stripe is not configured
- Pagination on the admin user list (50 users per page)
- Self-hosting callout section on the landing page — encourages users to run Chessstack on their own hardware with a link to the GitHub repo
- Landing page at `/landing` — hero section, feature overview, pricing comparison table, and footer with legal links; unauthenticated visitors are now redirected here instead of `/login`
- Terms of Service page at `/terms` (placeholder content for legal counsel review)
- Privacy Policy page at `/privacy` covering data collection, third-party services (Stripe, Lichess, Chess.com), GDPR rights, and cookies
- Monthly and annual subscription plans — users can choose between $3/month or $30/year at checkout, with a plan picker on the Settings page showing both options and savings
- `STRIPE_PRICE_ID_MONTHLY` and `STRIPE_PRICE_ID_ANNUAL` env vars replace the single `STRIPE_PRICE_ID`

### Fixed

- Registration page now uses the correct logo asset instead of an old hardcoded SVG icon
- Chess.com import now surfaces archive fetch failures instead of silently returning 0 games — throws a clear error when all archives return non-200
- Import endpoint returns a `reason` field (`no_new_games`, `no_games`, `all_skipped`) so the UI explains why 0 games were imported
- Content-Security-Policy now allows Cloudflare beacon script and analytics reporting
- Silent catch blocks in Lichess, Chess.com, and import scheduler now log warnings instead of swallowing errors
- Email send failures now log with a greppable `[EMAIL_SEND_FAILURE]` tag and include userId/email context
- Session expiry comment in schema said 30 days but code uses 14 days — updated comments to match
- Admin user deletion not cancelling Stripe subscriptions — subscription DB row was deleted but the Stripe API was never called; now cancels before cascade-delete
- Admin cascade delete missing `subscription` and `passwordResetToken` tables
- Stockfish analysis hanging forever when `STOCKFISH_MAX_CONCURRENT` env var is empty — `parseInt("", 10)` produced `NaN`, permanently blocking the concurrency semaphore
- Settings page showing "Monthly" for admin-gifted subscriptions that have no Stripe price ID

### Removed

- Old hand-crafted isometric favicon (`favicon.svg`)
- Social media kit and JPG print files from logos directory

### Security

- Added 1 MB size limit on PGN imports (server returns 413, client shows error before sending)

### Performance

- Added database indexes on `user_id` for 8 user tables (`user_settings`, `repertoire`, `user_move`, `user_repertoire_move`, `reviewed_game`, `drill_session`, `password_reset_token`, `email_verification_token`) — prevents sequential scans as data grows
- "Analyze on Lichess" link in Build mode — opens the current position on Lichess for deeper analysis

### Changed

- Checkout endpoint now accepts a `plan` parameter (`monthly` or `annual`) in the request body
- Settings page shows which billing interval (Monthly/Annual) the user is on instead of just "Paid"
- Dockerfile now downloads seed data dumps from GitHub Releases during build — Railway, CI, and local builds all work without needing the dump files in the repo
- Release workflow simplified — seed download step removed since the Dockerfile handles it
- Removed unused `resulting_fen` column from the celebrity moves table — simplifies storage and import scripts
- Lichess import script now aggregates one rating bracket at a time instead of materializing the entire dataset in a temp table — keeps disk usage manageable for large imports
- Default maximum review interval lowered from ~100 years to 365 days — cards no longer vanish indefinitely
- Light mode redesigned with ice-blue palette — softer on the eyes and aligned with brand colors
- Dark mode background shifted from pitch black to deep navy
- Blue chessboard theme now uses brand colors (Dim Blue dark squares, light blue-white light squares)
- Header bar has a clean edge in light mode instead of a blurred shadow
- Updated logo and added a warm white background for better visibility in dark mode
- Gap finder default threshold raised from 1,000 to 10,000 master games — less noise out of the box
- Build sidebar is more compact — repertoire tree starts collapsed (click to expand), action buttons consolidated into a single row of chips, and Import/Export PGN moved into a "⋯" overflow menu
- Dependency updates — patched prototype pollution vulnerabilities in devalue and flatted, plus minor bumps to SvelteKit, Svelte, Drizzle Kit, ts-fsrs, and typescript-eslint

---

- Repertoire locking for cancelled subscriptions — when a user's tier reverts to free, only their first (oldest) repertoire remains active; additional repertoires become read-only with export and delete still available
- Server-only tier helpers (`tiers.server.ts`) for DB-backed repertoire lock checks on all write API endpoints
- Locked repertoire indicators in the manage modal with "Read-only" badge and upgrade prompt
- Stripe billing integration — users can upgrade from free to paid via Stripe Checkout, manage billing (cancel, update payment, view invoices) via Stripe Customer Portal, and webhooks keep the subscription table in sync
- Billing UI on the Settings page — shows current plan, upgrade button (free tier), manage billing button (paid tier), cancellation notices, payment failure warnings, and post-checkout confirmation
- `billingEnabled` layout flag — hides the billing section when Stripe is not configured
- First-user admin bootstrap — the first account registered on a fresh database is automatically promoted to admin
- Subscription schema — `subscription` and `password_reset_token` tables, plus `email` and `stripe_customer_id` columns on user
- Tier model — every authenticated request loads the user's tier (`free` or `paid`) from the database and passes it to all pages
- Tier constants (`src/lib/stripe/tiers.ts`) defining per-tier limits for repertoires and Stockfish depth
- Tier enforcement — free users are hard-capped at Stockfish depth 15 (stream + settings save endpoints) and 1 repertoire (modal shows upgrade message at limit); settings slider dynamically reflects tier max
- Audit log table — all admin actions (create, update, delete, password reset) are recorded with admin and target user IDs
- CORS configuration — allowlist of permitted origins via `CORS_ORIGINS` env var
- Expired session cleanup — stale sessions are automatically pruned every 6 hours
- Per-user rate limiting on expensive endpoints — Stockfish analysis (single, batch, stream), game imports, and game analysis are all rate-limited per user with configurable thresholds via env vars
- Missing `rate_limit` table migration added to 0018

### Changed

- Docker Compose now reads all environment variables from `.env` via interpolation instead of hardcoding values — added passthrough for Stripe, CORS, rate limit, and other vars
- Seed data path is now configurable via `SEED_DATA_PATH` env var
- Rate limiting moved from in-memory to database-backed sliding window for multi-instance support
- Secure cookie flag is now derived from ORIGIN (https = secure, http = plain) instead of being hardcoded to true
- Session cookie `sameSite` changed from `strict` to `lax` so sessions survive external redirects (Stripe checkout/portal return)
- CSP header updated to allow SvelteKit inline scripts and Google Fonts

### Fixed

- Health check endpoint no longer queries the database, preventing false failures when the DB is slow
- Import scheduler now uses a PostgreSQL advisory lock to prevent duplicate runs across multiple instances
- Stripe cancellation detection now checks both `cancel_at_period_end` and `cancel_at` fields

### Security

- Removed default admin account auto-creation — first user must be created explicitly
- Removed hardcoded database credentials from Docker Compose
- `DATABASE_URL` is now required — removed silent localhost fallback that could mask misconfiguration
- Login rate limiting — 10 attempts per 15 minutes per IP
- Registration rate limiting — 5 attempts per hour per IP
- Stockfish concurrency semaphore — limits parallel engine processes to prevent CPU exhaustion
- Cookie settings hardened — `Secure` (when HTTPS), `SameSite=Strict`, 14-day max session lifetime
- Error logging sanitized — server hooks no longer log request bodies, query params, or full error objects
- HSTS header added (2-year max-age with includeSubDomains) and security headers updated
- Stripe webhook endpoint authenticated via signature verification, not session cookies

---

## [1.1.2] — 2026-03-14

### Added

- Correct-move arrow in drill mode — a green arrow on the board shows the right move when you guess wrong, instead of only showing notation
- Playback speed setting — slider in Settings → Drill to control how fast moves are auto-played in drill and review (200ms–2000ms)
- Game review move evaluations — each move shows an inline eval and is color-coded by centipawn loss (best/good/inaccuracy/mistake/blunder)
- "Your Move" sidebar card shows a live-updating eval and CPL color that refines as the engine analyzes deeper
- Server-side logging — startup confirmation, Stockfish failure warnings, failed login attempts, and unhandled error catch-all now appear in `docker logs`
- "Ready at" startup message showing the configured ORIGIN URL

### Changed

- Licensed the project under AGPL-3.0-or-later (previously stated as MIT with no formal license file)

---

## [1.1.1] — 2026-03-12

### Fixed

- Engine eval suggestions not streaming progressively in Docker/production builds

---

## [1.1.0] — 2026-03-12

### Added

- Custom Chessstack logo — isometric chessboard with pawn, used as both favicon and header brand icon
- Guided tutorial for first-time users — a floating card walks new users through Build, Drill, Puzzles, and Review step by step
- "Restart Tutorial" button in Settings to replay the walkthrough at any time
- Streaming engine analysis — the eval bar and candidate move scores now update progressively as Stockfish searches deeper, instead of waiting for the full analysis to finish
- Masters database and puzzle database now ship pre-loaded in the Docker image — no manual download or restore steps required; data is seeded automatically on first boot
- Resizable chessboard — drag the bottom-right corner handle to make the board larger or smaller; your preferred size is saved across sessions and shared across all pages
- Start screen on the Drill page — see how many cards are due with a depth breakdown before you begin, choose your drill type and filters, then hit Start Drilling (or press Space)
- Line-based drilling — toggle between Cards and Lines mode in Drill to practice complete variations from start to leaf, with auto-grading and automatic opponent moves
- Blindfold mode in Drill — hide all pieces and play from memory, with move announcements displayed on the board during auto-play
- Configurable gap threshold dropdown on the dashboard widget — filter gaps by minimum master games played (10 / 100 / 1,000 / 10,000)
- Drill All mode to practice every card in the repertoire regardless of schedule
- Dark/light theme toggle in Settings
- Evaluation bar next to the board in Build Mode showing the engine's position assessment at a glance
- Undo button for drill grades so you can correct a mis-tap
- Keyboard shortcuts and move preview arrows in Build Mode
- Explore Mode on the Build page — try moves on the board without saving them to your repertoire
- Repertoire health score widget on the Dashboard — now shows actionable tips (e.g. "Drill 12 due cards to improve") linking to the right page
- Tempo training — optional countdown timer for Drill Mode (configurable 3–30 seconds per move in Settings; auto-fails if time runs out)

### Changed

- Renamed project from "Chess Reps" to "Chessstack" across all branding, Docker images, database defaults, and documentation
  - **Breaking**: Default database credentials changed — existing installations must set explicit `DATABASE_URL`/`POSTGRES_*` env vars with old values, or back up and restore data
  - Session cookie renamed; existing sessions will be invalidated (sign in again)
- Complete UI redesign: switched from DM Serif Display + JetBrains Mono to Manrope font family
- New color palette with warm tones, updated accent color, and refined border/shadow/radius tokens
- Refreshed styling across all components — modals, buttons, tabs, move lists, onboarding, login/register, settings, and admin pages
- Sidebar panels on Build, Drill, Puzzles, and Review pages now have a visible card background for better visual separation
- Wider page layouts across the site reduce blank space on desktop screens
- Light theme background is now a warm light gray instead of near-white
- Board-to-sidebar spacing tightened so the sidebar sits closer to the chessboard
- Dashboard stat widgets now display as a clean 2×3 grid instead of 4 columns with empty space
- Import buttons on the Review page now have a distinct background against their card panel
- Compact move suggestions in Build Mode — book and masters candidates now use a denser single-line layout with inline WDL bars, scrollable after 5 rows
- Gap Finder now uses the masters game database as its primary source, showing the most commonly played opponent moves you haven't prepared for — falls back to book moves for positions without master data
- Gap finder logic extracted into a shared utility, eliminating duplicated code between the dashboard and API endpoint
- Game import now runs in a single database transaction so the watermark stays in sync with inserted data
- Theme query in request hooks is now skipped for API calls, reducing a database round-trip on every API request
- Updated all devDependencies to latest compatible versions
- Upgraded chessground from 9.x to 10.x (internal DOM performance optimization, no API changes)

### Fixed

- Board layout now adapts to different monitor sizes — the sidebar hugs the board instead of leaving a gap, and the board auto-shrinks to fit smaller screens (e.g. 1080p) without manual resizing
- Move suggestion tabs (Book/Masters/Engine) no longer jump back to Book after selecting a move — the tab stays on whichever view you're using unless it has no results for the new position
- Color indicators for imported games now use explicit colored dots instead of Unicode chess pieces that rendered as the wrong color on dark backgrounds
- Chess.com and Lichess game import now checks both player names explicitly and falls back to PGN headers, preventing color misdetection
- Puzzle page chessboard now displays correctly on first visit without needing a manual resize
- Board resize no longer resets navigation state on build, drill, review, or puzzle pages
- Puzzles page now respects "auto" board size instead of always defaulting to 520px
- Foreign keys now use ON DELETE CASCADE (or SET NULL for imported game links), preventing orphaned rows when users or repertoires are deleted
- Puzzle finder now uses a database subquery instead of loading all attempted puzzle IDs into memory
- Deleting a repertoire no longer leaves dangling references in the imported games table
- Drill auto-play now works correctly for positions reached via transpositions (different move orders to the same board position)
- Drill auto-play sounds no longer continue playing after navigating away from Drill Mode
- Dashboard grid layout no longer breaks with the health score widget
- Pending timers on the Puzzles, Settings, Build, and Manage Repertoire pages are now cleared on navigation, preventing stale callbacks from firing after unmount
- Removed duplicate CSS rules and added missing aria-labels to icon-only buttons for accessibility
- Docker volume warning resolved by marking the named volume as external

### Security

- Added security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) on all responses
- Puzzle theme filter now rejects values containing regex metacharacters, preventing pattern injection
- All `as Error` casts replaced with `instanceof Error` type guards for safer error handling
- Drill undo now validates all FSRS fields (type, range, and format) before writing to the database
- ECO lookup now validates FEN structure (field count, piece placement, side-to-move) before querying

### Removed

- Unused Lichess API stub endpoint (game import was already handled elsewhere)

---

## [1.0.2] — 2026-03-06

### Fixed

- Fixed crash in Review Mode when viewing a deviation from repertoire (infinite reactive loop)

---

## [1.0.1] — 2026-03-06

### Added

- Delete confirmation modal in Build Mode before removing moves

### Changed

- Standardized project documentation for public release
- Cleaned up stale files and expanded `.dockerignore` for smaller build context

### Fixed

- Puzzle opening matching now uses tree-aware ECO selection for more accurate results
- Formatting and code style consistency improvements

---

## [1.0.0] — 2026-03-04

First stable release. A fully self-hosted chess opening trainer with spaced repetition,
game review, puzzle training, and a local masters database — all running offline in Docker.

### Added

#### Core

- **Build Mode** — interactive repertoire builder with auto-saving moves, turn enforcement,
  undo, delete with subtree cascade, and move annotations
- **Drill Mode** — spaced repetition practice using the FSRS algorithm with auto-play to
  the due position, correct/incorrect feedback, confidence-based grading (Forgot/Unsure/Easy),
  hint button, keyboard shortcuts, and session persistence
- **Game Review** — paste a PGN to analyze against your repertoire with auto-play,
  deviation detection, Stockfish eval comparisons, and one-click repertoire updates
- **Puzzle Training** — solve tactics from the Lichess puzzle database matched to your
  repertoire openings with rating and theme filters
- **Explorer / Tree View** — collapsible repertoire tree in the Build Mode sidebar
  with click-to-navigate and current position highlighting

#### Repertoire Management

- Multiple repertoire support with create, rename, delete, and color selection
- Active repertoire persisted across sessions
- Configurable start position per repertoire to scope drill and gap detection
- PGN import with variation parsing, conflict resolution, and annotation preservation
- PGN export with all variations and annotations (download or clipboard)
- Onboarding screen for new users with inline repertoire creation

#### Analysis

- Stockfish engine integration with configurable depth and timeout
- Candidate move display with Book, Masters, and Engine tabs
- Local masters database (Chessmont, ~8.8M positions from 21.5M master games)
  with W/D/L statistics per move
- ECO opening name display (3,641 positions from the Lichess ECO dataset)

#### Dashboard

- Due Now count with link to Drill
- Mastered card count and percentage
- Streak tracker (consecutive days with completed drill sessions)
- Next Review countdown
- Card State Breakdown (New / Learning / Review / Relearning bar)
- Accuracy Trend (last 14 sessions as colored blocks)
- Gap Finder with deep links to Build Mode
- Trouble Spots showing top leeches by lapse count
- Puzzle goal widget with configurable daily/weekly/monthly targets

#### Game Import

- Lichess and Chess.com game import with smart repertoire matching
- Imported game list with status tracking and filter chips
- Watermark-based incremental import (only fetches new games)

#### User Management

- Multi-user support with role-based access (admin / user)
- Admin panel for creating, disabling, promoting, and deleting accounts
- Configurable registration mode (open or invite-only)
- Session-based authentication with secure cookie handling

#### Settings

- Board theme selection (brown, blue, green, purple, grey) with live preview
- Sound effects toggle with distinct audio cues for moves, captures, correct, and incorrect
- Stockfish depth and analysis timeout sliders
- Password change with session invalidation

#### Infrastructure

- Docker Compose deployment (app + PostgreSQL)
- Stockfish installed in the app container as a child process
- PostgreSQL with automatic migrations on startup
- Health check endpoint compatible with monitoring tools
- GitHub Actions CI with migration smoke tests
- Security scanning pipeline (Gitleaks, Semgrep, npm audit, Trivy)
- Production Docker Compose and container release workflow
- Data distribution scripts for GitHub Releases

### Changed

- Database migrated from SQLite to PostgreSQL
- UI redesigned with dark luxury theme, design tokens, and responsive layouts
- Mobile-first responsive optimization across all pages and modals
- Evals displayed from the player's perspective (positive = good for you)

---

[Unreleased]: https://github.com/PvtTwinkle/chessstack/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/PvtTwinkle/chessstack/releases/tag/v1.4.0
[1.3.1]: https://github.com/PvtTwinkle/Chessstack/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/PvtTwinkle/Chessstack/compare/v1.2.2...v1.3.0
[1.2.2]: https://github.com/PvtTwinkle/Chessstack/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/PvtTwinkle/Chessstack/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/PvtTwinkle/Chessstack/compare/v1.1.2...v1.2.0
[1.1.2]: https://github.com/PvtTwinkle/Chessstack/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/PvtTwinkle/Chessstack/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/PvtTwinkle/Chessstack/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/PvtTwinkle/Chessstack/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/PvtTwinkle/Chessstack/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/PvtTwinkle/Chessstack/releases/tag/v1.0.0
