# Third-Party Notices

Chessstack uses the following third-party data and assets. Thank you to these
projects and their contributors.

---

## Chessmont Dataset

- **Source**: https://www.kaggle.com/datasets/chessmontdb/chessmont-big-dataset
- **Creator**: ChessmontDB (https://www.kaggle.com/chessmontdb)
- **License**: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
- **Tool**: https://github.com/Chessmont/ChessDatasetGenerator

**What we use**: Master game statistics derived from ~21.5 million games (ELO >= 2500).

**Modifications**: The raw PGN data was parsed, positions were normalized to
4-field FEN format, and move statistics (wins, draws, losses, game count) were
aggregated per position-move pair. Only positions with 5 or more games were
retained, resulting in ~8.8 million rows stored in the `chessmont_moves` table.

---

## Lichess Puzzle Database

- **Source**: https://database.lichess.org/#puzzles
- **Creator**: [Lichess](https://lichess.org)
- **License**: [CC0 1.0 (Public Domain)](https://creativecommons.org/publicdomain/zero/1.0/)

**What we use**: Puzzles filtered by opening tag to match the user's repertoire.

---

## Lichess Chess Openings

- **Source**: https://github.com/lichess-org/chess-openings
- **Creator**: [Lichess](https://lichess.org)
- **License**: [CC0 1.0 (Public Domain)](https://creativecommons.org/publicdomain/zero/1.0/)

**What we use**: ECO codes, opening names, and move sequences used to populate
the `eco_opening` and `book_move` tables.

---

## Lichess Open Database

- **Source**: https://database.lichess.org/
- **Creator**: [Lichess](https://lichess.org)
- **License**: [CC0 1.0 (Public Domain)](https://creativecommons.org/publicdomain/zero/1.0/)

**What we use**: Aggregated move statistics from Lichess games, broken down by
rating bracket. This data powers the "Players" tab in Build Mode and is stored
in the `lichess_moves` table.

**Modifications**: Monthly game exports were downloaded, parsed, and aggregated
into per-position move statistics (wins, draws, losses, game count) grouped by
rating bracket. The aggregated data is shipped pre-loaded in the Docker image.

---

## Star Player Games

- **Sources**:
  - [PGN Mentor](https://www.pgnmentor.com/) (OTB tournament game archives for classic players)
  - [Lichess API](https://lichess.org/api) (game exports, [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/))
  - [Chess.com Published Data API](https://www.chess.com/news/view/published-data-api) (game archives)

**What we use**: Games from notable players (legends, super-GMs, streamers)
sourced from PGN Mentor archives and the Lichess/Chess.com public APIs. This
data powers the "Stars" tab in Build Mode and is stored in the `star_players`
and `celebrity_moves` tables.

**Modifications**: PGN files were parsed, positions were normalized to 4-field
FEN format, and move statistics were aggregated per player per position-move pair.
The aggregated data is shipped pre-loaded in the Docker image.

---

## Lichess Sound Assets

- **Source**: https://github.com/lichess-org/lila
- **Creator**: [Lichess](https://lichess.org)
- **License**: [AGPL v3+](https://www.gnu.org/licenses/agpl-3.0.html)

**What we use**: Sound effects for move, capture, correct, and incorrect events
(`move.mp3`, `capture.mp3`, `correct.mp3`, `incorrect.mp3`).

---

## Manrope Font

- **Source**: https://github.com/sharanda/manrope (files from [Fontsource](https://fontsource.org/fonts/manrope), `@fontsource-variable/manrope` 5.3.0)
- **Creator**: The Manrope Project Authors
- **License**: [SIL Open Font License 1.1](https://openfontlicense.org) (full text in `src/lib/assets/fonts/manrope/OFL.txt`)

**What we use**: The Manrope variable font (WOFF2, split into Latin, Latin
Extended, Cyrillic, Greek and Vietnamese subsets) as the interface typeface,
served from our own domain.

---

## Stockfish and Stockfish.js

- **Source**: https://github.com/official-stockfish/Stockfish and https://github.com/nmrugg/stockfish.js/tree/v19.0.0 (`stockfish` npm package 19.0.0)
- **Creators**: The Stockfish developers; Stockfish.js by Nathan Rugg and Chess.com
- **License**: [GNU GPL v3](https://www.gnu.org/licenses/gpl-3.0.html) (full text in `engine/COPYING.txt`)

**What we use**: The "lite" multi-threaded and single-threaded WebAssembly builds of
Stockfish 19, unmodified, in `engine/`. They are sent to the browser, which runs the
engine analysis locally.
