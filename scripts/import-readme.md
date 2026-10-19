# Reference datasets

The four datasets the Docker image loads on first boot (see the README) are built offline into
PostgreSQL tables and then dumped with `scripts/data-export.sh`, which writes the four
`*-dump.sql.gz` files for a `data-v*` release. Where each one comes from:

| Dataset | Table(s)                          | Source                                                                                                     | Built with                                                                                                                   |
| ------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Masters | `chessmont_moves`                 | [Chessmont dataset](https://www.kaggle.com/datasets/chessmontdb/chessmont-big-dataset) (games rated 2500+) | `scripts/chessmont-import.py` (see its header for options)                                                                   |
| Players | `lichess_moves`                   | [Lichess open database](https://database.lichess.org/), monthly "Standard rated" files                     | `scripts/lichess-import.py` (below)                                                                                          |
| Stars   | `star_players`, `celebrity_moves` | Each player's games from Lichess, Chess.com or a PGN file                                                  | `scripts/celebrity-download.py` and `scripts/celebrity-import.py` ([guide](../docs/star-player-import-guide.md))             |
| Puzzles | `puzzle`                          | [Lichess puzzle database](https://database.lichess.org/#puzzles) (`lichess_db_puzzle.csv`)                 | Loaded once from the CSV; no script is kept. `opening_family` holds the most specific of each puzzle's Lichess opening tags. |

Licences and credits are in [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md).

---

# Players database (Lichess import) -- quick reference

## Prerequisites (already installed)

- Python 3.9+ with python-chess, psycopg2-binary, zstandard
- PostgreSQL client (pg_dump)
- Docker

## Download

Browse https://database.lichess.org/ and download the "Standard rated"
.pgn.zst file for the month you want.

## Run docker PostgreSQL container

```
docker run -d --name pg \
  -e POSTGRES_DB=chessstack \
  -e POSTGRES_USER=chessstack \
  -e POSTGRES_PASSWORD=chessstack_secret \
  -p 127.0.0.1:5432:5432 \
  --shm-size=2g \
  -v chessstack-pgdata:/var/lib/postgresql/data \
  postgres:17-alpine
```

After first start, tune PostgreSQL for the server hardware (31GB RAM, 20 cores):

```
docker exec pg psql -U chessstack -c "ALTER SYSTEM SET shared_buffers = '8GB';"
docker exec pg psql -U chessstack -c "ALTER SYSTEM SET maintenance_work_mem = '2GB';"
docker exec pg psql -U chessstack -c "ALTER SYSTEM SET max_parallel_workers = 16;"
docker exec pg psql -U chessstack -c "ALTER SYSTEM SET max_worker_processes = 20;"
docker restart pg
```

## Import a new month (cumulative, adds to existing data)

```
DATABASE_URL="postgresql://chessstack:chessstack_secret@localhost:5432/chessstack" \
python3 lichess-import.py /path/to/lichess_db_standard_rated_YYYY-MM.pgn.zst \
  --workers 18 \
  --batch-size 5000 \
  --total-games <check lichess site for game count> \
  --min-games 10 \
  --min-dump-games 50 \
  --dump
```

`--min-games 10` keeps positions with 10+ games in the database so they can
accumulate across months. `--min-dump-games 50` filters the dump file to only
include positions with 50+ games for the dev machine.

## Copy the dump back to your dev machine

```
scp ~/lichess-moves-dump.sql.gz you@devmachine:/path/to/Chessstack/
```

## Then on your dev machine

```
docker compose up -d --build
```

## Other commands

Resume after Ctrl+C:

    Add --resume to the import command above

Load multiple months without finalizing between each:

    Add --no-finalize to each month's import command
    Then run:
    python3 lichess-import.py --finalize-only --min-games 10 --min-dump-games 50 --dump

Full reset (delete all lichess data):

    python3 lichess-import.py --clean

Check server core count (for --workers):

    nproc
    Use nproc minus 2 for --workers

Check how many positions are shipped vs still accumulating:

```
docker exec pg psql -U chessstack -d chessstack -c "
  SELECT
    COUNT(*) FILTER (WHERE games_played >= 50) AS shipped,
    COUNT(*) FILTER (WHERE games_played >= 10 AND games_played < 50) AS accumulating
  FROM lichess_moves;
"
```

## Volume migration (one-time)

If migrating from an anonymous Docker volume to the named volume:

```
docker stop pg && docker rm pg
docker volume create chessstack-pgdata
docker run --rm \
  -v <old-volume-hash>:/source:ro \
  -v chessstack-pgdata:/dest \
  alpine sh -c "cp -a /source/. /dest/"
```

Then start the container with the new named volume (see above) and verify:

```
docker exec pg psql -U chessstack -c "SELECT COUNT(*) FROM lichess_moves;"
```
