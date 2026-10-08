<p align="center">
  <img src="logos/logo.svg" alt="Chessstack Logo" width="120" />
</p>

<h1 align="center">Chessstack</h1>

<p align="center">
  A self-hosted web application for learning and drilling chess openings using spaced repetition.
</p>

<p align="center">
  Build your own opening repertoire on an interactive board, train with intelligent spaced repetition,
  prepare against specific opponents, and review your games - all offline, all yours.
</p>

---

<p align="center">
  <img src="docs/screenshots/dashboard.png" alt="Dashboard" width="400" />
  &nbsp;&nbsp;
  <img src="docs/screenshots/build.png" alt="Build Mode" width="400" />
</p>
<p align="center">
  <img src="docs/screenshots/drill.png" alt="Drill Mode" width="400" />
  &nbsp;&nbsp;
  <img src="docs/screenshots/prep.png" alt="Opponent Prep" width="400" />
</p>

---

## Features

### Repertoire Building

Build your opening repertoire on an interactive board. As you play moves, the app
shows candidate moves from multiple sources to help you choose your lines:

- Book moves from opening theory
- Master game statistics from 8.8 million+ games (ELO 2500+)
- Famous player lines (legends, super-GMs, streamers)
- Crowd-sourced Lichess data broken down by rating bracket
- Stockfish engine evaluations, computed in your browser

You can annotate any move with notes, bulk-import variations from PGN files, and
export your full repertoire as PGN.

### Training

The drill system uses the FSRS spaced repetition algorithm to schedule your reviews.
The board auto-plays your opponent's moves, you respond, and the algorithm adjusts
the schedule based on how well you know each position.

The opening trainer plays out your openings against a computer that picks its moves
from real game statistics, and tracks an Elo-style trainer rating.

Puzzles are pulled from the Lichess puzzle database, filtered to match the openings
in your repertoire. You can also filter by rating, theme, and opening family.

### Preparation

Download an opponent's games from Lichess or Chess.com to see their most-played
moves and find gaps in your repertoire. Add any missing lines directly from the
prep view and export them as drill cards.

For post-game review, paste a PGN or import games to see where you or your opponent
deviated from your prep. You can add new moves to your repertoire right from the
review screen.

### Dashboard & Analytics

The dashboard shows your repertoire health at a glance: due cards, mastered
positions, review streaks, and an overall health score.

The gap finder detects opponent moves your repertoire doesn't cover, weighted by
how often they appear in master games. Trouble spots highlight positions you
repeatedly get wrong. Accuracy trends chart your drill performance over time.

You can also set daily, weekly, or monthly puzzle goals.

---

## Quick Start

### Requirements

- [Docker](https://docs.docker.com/get-docker/)
- [Docker Compose](https://docs.docker.com/compose/install/) (included with Docker Desktop)

### Docker Setup

**1. Create a `docker-compose.yml` file:**

```yaml
services:
  app:
    image: ghcr.io/pvttwinkle/chessstack:latest
    container_name: chessstack-app
    restart: unless-stopped
    ports:
      - '3000:3000'
    environment:
      - DATABASE_URL=postgresql://chessstack:chessstack_secret@postgres:5432/chessstack
      - ORIGIN=http://localhost:3000
      - DEFAULT_USERNAME=admin
      - DEFAULT_PASSWORD=changeme
      - REGISTRATION_MODE=invite
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ['CMD', 'wget', '-qO-', 'http://localhost:3000/api/health']
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
  postgres:
    image: postgres:17-alpine
    container_name: chessstack-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: chessstack
      POSTGRES_USER: chessstack
      POSTGRES_PASSWORD: chessstack_secret
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U chessstack']
      interval: 10s
      timeout: 5s
      retries: 5
volumes:
  pgdata:
```

**2. Start the app:**

```bash
docker compose up -d
```

**3. Open your browser:**

```
http://localhost:3000
```

Log in with the username and password you set above. Change the default password
after your first login.

---

## Included Data

The Docker image ships with four reference datasets that load automatically on first
startup - no extra steps required:

| Dataset              | Description                                                                                                                                                     | Approx. Size |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **Masters Database** | ~8.8M moves from master-level games (ELO 2500+). Powers the "Masters" tab. Filtered to positions that have only occurred at least two times.                    | ~131 MB      |
| **Lichess Puzzles**  | Opening-tagged tactical puzzles. Powers the Puzzles page.                                                                                                       | ~69 MB       |
| **Stars Database**   | Moves from famous players throughout chess history. Powers the "Stars" tab.                                                                                     | ~34 MB       |
| **Players Database** | Most-played moves from the Lichess Open Database by rating bracket. Powers the "Players" tab. Filtered to positions that have only occurred at least 100 times. | ~14 MB       |

The first boot takes a little longer while the data loads into PostgreSQL.
Check `docker compose logs -f app` for progress. Subsequent startups skip this step
entirely.

---

## Configuration

| Variable                       | Required  | Description                                                                                                                             |
| ------------------------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                 | Yes       | PostgreSQL connection string. Default points to the `postgres` container on the internal Docker network.                                |
| `ORIGIN`                       | Yes       | The URL you use to access the app. Change this if using a reverse proxy (e.g. `https://chess.yourdomain.com`). Required for security.   |
| `DEFAULT_USERNAME`             | First run | Username created when the database is empty. Ignored after first run.                                                                   |
| `DEFAULT_PASSWORD`             | First run | Password created when the database is empty. **Change this before first run.** Ignored after first run.                                 |
| `REGISTRATION_MODE`            | No        | `invite` (admin creates users) or `open` (anyone can register at `/register`). Default: `invite`.                                       |
| `GAME_IMPORT_INTERVAL_MINUTES` | No        | How often (in minutes) the app syncs games from Lichess & Chess.com for review. `0` = manual only. Default: `0`.                        |
| `ADDRESS_HEADER` / `XFF_DEPTH` | No        | Behind a reverse proxy: the header carrying the client IP, so login rate limits apply per visitor. See [Reverse Proxy](#reverse-proxy). |

[`.env.example`](.env.example) lists every variable with comments, including log format, rate
limits and CORS. Optional email (Loops) and error reporting (Sentry) stay switched off unless you
set their variables; nothing is sent anywhere by default.

---

## Updating

```bash
docker compose pull && docker compose up -d
```

Database changes are applied automatically on startup, including when upgrading from any 1.x
release. Take a backup first (see below).

---

## Backup & Restore

Your data lives in the PostgreSQL container's named volume (`pgdata`).

```bash
# Back up
docker exec chessstack-postgres pg_dump -U chessstack chessstack > backup.sql

# Restore
docker compose down
docker volume rm chessstack_pgdata
docker compose up -d
docker exec -i chessstack-postgres psql -U chessstack chessstack < backup.sql
```

---

## Reverse Proxy

If you expose Chessstack through Nginx Proxy Manager, Caddy, or Traefik, set
`ORIGIN` to your full domain:

```yaml
- ORIGIN=https://chess.yourdomain.com
```

SvelteKit uses the `ORIGIN` value to validate requests and prevent cross-site
attacks. When `ORIGIN` starts with `https://`, cookies are automatically marked
as secure.

Login attempts are rate-limited per client IP. Behind a proxy the app only sees
the proxy's IP, so tell it which header carries the real one:

```yaml
- ADDRESS_HEADER=X-Forwarded-For
- XFF_DEPTH=1 # the number of proxies in front of the app
```

---

## Health Check

| Endpoint                | Returns                                                                      |
| ----------------------- | ---------------------------------------------------------------------------- |
| `GET /api/health`       | `{"status":"ok"}` once the app has started (used by the Docker health check) |
| `GET /api/health/ready` | `{"status":"ok","db":"ok"}`, or HTTP 503 when the database is unreachable    |

No authentication required. Point [Uptime Kuma](https://github.com/louislam/uptime-kuma)
or other monitoring tools at `/api/health/ready`.

---

## Built With

|                                                              |                                 |
| ------------------------------------------------------------ | ------------------------------- |
| [SvelteKit](https://kit.svelte.dev/)                         | Full-stack framework            |
| [PostgreSQL](https://www.postgresql.org/)                    | Database                        |
| [Chessground](https://github.com/lichess-org/chessground)    | Interactive board UI            |
| [chess.js](https://github.com/jhlywa/chess.js)               | Move validation and PGN parsing |
| [Stockfish](https://stockfishchess.org/)                     | Chess engine analysis           |
| [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) | Spaced repetition algorithm     |
| [Drizzle ORM](https://orm.drizzle.team/)                     | TypeScript ORM                  |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup and tests, and
[SECURITY.md](SECURITY.md) for reporting a vulnerability privately.

---

## Acknowledgments

Chessstack uses data from the following open-source projects:

- **[Chessmont](https://www.kaggle.com/datasets/chessmontdb/chessmont-big-dataset)** - Master game database (CC BY-SA 4.0)
- **[Lichess Puzzle Database](https://database.lichess.org/#puzzles)** - Tactical puzzles (CC0)
- **[Lichess Chess Openings](https://github.com/lichess-org/chess-openings)** - ECO opening names (CC0)
- **[Lichess Open Database](https://database.lichess.org/)** - Player game data (CC0)
- **[PGN Mentor](https://www.pgnmentor.com/)** - Classic player game archives
- **[Lichess](https://github.com/lichess-org/lila)** - Sound assets (AGPL v3+)

See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) for full attribution and license details.

## License

Chessstack is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE) (AGPL-3.0-or-later).

You are free to self-host, modify, and redistribute this software. If you run a
modified version as a network service, you must make your source code available
to its users under the same license. See the [LICENSE](LICENSE) file for full terms.
