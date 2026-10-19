# Star Player Import Guide

Step-by-step commands to import each player into the Stars tab database.

## Prerequisites

```bash
# Install Python dependencies (if not already installed)
pip install python-chess psycopg2-binary zstandard requests

# Set your database connection (adjust if your Docker postgres uses different creds)
export DATABASE_URL="postgresql://chessstack:chessstack_secret@localhost:5432/chessstack"
```

All commands below assume you're in the Chessstack project root directory.

---

## Classic Legends

All classic players are sourced from PGN Mentor (OTB tournament games only).

### Bobby Fischer

- **PGN Mentor**: `Fischer.zip` (~827 games)
- **Online accounts**: None (historical)

```bash
wget -P /tmp https://www.pgnmentor.com/players/Fischer.zip
unzip -o /tmp/Fischer.zip -d /tmp
python scripts/celebrity-import.py /tmp/Fischer.pgn \
  --player bobby-fischer \
  --display-name "Bobby Fischer" \
  --platform pgn \
  --category legend
```

### Garry Kasparov

- **PGN Mentor**: `Kasparov.zip` (~2,128 games)
- **Chess.com**: `GarryKasparov` (verified GM, but low activity)

```bash
wget -P /tmp https://www.pgnmentor.com/players/Kasparov.zip
unzip -o /tmp/Kasparov.zip -d /tmp
python scripts/celebrity-import.py /tmp/Kasparov.pgn \
  --player garry-kasparov \
  --display-name "Garry Kasparov" \
  --platform pgn \
  --category legend
```

### Anatoly Karpov

- **PGN Mentor**: `Karpov.zip` (~3,529 games)
- **Online accounts**: None verified

```bash
wget -P /tmp https://www.pgnmentor.com/players/Karpov.zip
unzip -o /tmp/Karpov.zip -d /tmp
python scripts/celebrity-import.py /tmp/Karpov.pgn \
  --player anatoly-karpov \
  --display-name "Anatoly Karpov" \
  --platform pgn \
  --category legend
```

### Mikhail Tal

- **PGN Mentor**: `Tal.zip` (~2,431 games)
- **Online accounts**: None (historical)

```bash
wget -P /tmp https://www.pgnmentor.com/players/Tal.zip
unzip -o /tmp/Tal.zip -d /tmp
python scripts/celebrity-import.py /tmp/Tal.pgn \
  --player mikhail-tal \
  --display-name "Mikhail Tal" \
  --platform pgn \
  --category legend
```

### Jose Raul Capablanca

- **PGN Mentor**: `Capablanca.zip` (~597 games)
- **Online accounts**: None (historical)

```bash
wget -P /tmp https://www.pgnmentor.com/players/Capablanca.zip
unzip -o /tmp/Capablanca.zip -d /tmp
python scripts/celebrity-import.py /tmp/Capablanca.pgn \
  --player jose-capablanca \
  --display-name "Jose Raul Capablanca" \
  --platform pgn \
  --category legend
```

### Paul Morphy

- **PGN Mentor**: `Morphy.zip` (~211 games)
- **Online accounts**: None (historical)

```bash
wget -P /tmp https://www.pgnmentor.com/players/Morphy.zip
unzip -o /tmp/Morphy.zip -d /tmp
python scripts/celebrity-import.py /tmp/Morphy.pgn \
  --player paul-morphy \
  --display-name "Paul Morphy" \
  --platform pgn \
  --category legend
```

### Frank Marshall

- **PGN Mentor**: `Marshall.zip` (~1,027 games)
- **Online accounts**: None (historical)

```bash
wget -P /tmp https://www.pgnmentor.com/players/Marshall.zip
unzip -o /tmp/Marshall.zip -d /tmp
python scripts/celebrity-import.py /tmp/Marshall.pgn \
  --player frank-marshall \
  --display-name "Frank Marshall" \
  --platform pgn \
  --category legend
```

### Judit Polgar

- **PGN Mentor**: `PolgarJ.zip` (~1,825 games) -- note the "J" suffix
- **Chess.com**: `JuditPolgar` (verified GM)

```bash
wget -O /tmp/PolgarJ.zip https://www.pgnmentor.com/players/PolgarJ.zip
unzip -o /tmp/PolgarJ.zip -d /tmp
python scripts/celebrity-import.py /tmp/PolgarJ.pgn \
  --player judit-polgar \
  --display-name "Judit Polgar" \
  --platform pgn \
  --category legend
```

### Susan Polgar

- **PGN Mentor**: `PolgarS.zip` (~856 games) -- note the "S" suffix
- **Chess.com**: `SusanPolgar` (verified GM)

```bash
wget -O /tmp/PolgarS.zip https://www.pgnmentor.com/players/PolgarS.zip
unzip -o /tmp/PolgarS.zip -d /tmp
python scripts/celebrity-import.py /tmp/PolgarS.pgn \
  --player susan-polgar \
  --display-name "Susan Polgar" \
  --platform pgn \
  --category legend
```

---

## Modern Super-GMs

These players have both PGN Mentor (OTB) games and online accounts. For each, we import OTB games from PGN Mentor first, then register the online account for future API downloads.

> **Multi-source note**: Each player can only have one `--platform` for auto-downloads, but you can manually import from additional sources at any time. All games merge under the same slug — W/D/L counts are summed. See the Magnus entry for a full example of importing from PGN Mentor + Chess.com + Lichess.

### Magnus Carlsen

- **PGN Mentor**: `Carlsen.zip` (~6,615 OTB games)
- **Lichess**: `DrNykterstein` (confirmed GM, ~10K games — mostly bullet)
- **Chess.com**: `MagnusCarlsen` (confirmed GM, ~9K games)

```bash
# Step 1: OTB games from PGN Mentor
wget -P /tmp https://www.pgnmentor.com/players/Carlsen.zip
unzip -o /tmp/Carlsen.zip -d /tmp
python scripts/celebrity-import.py /tmp/Carlsen.pgn \
  --player magnus-carlsen \
  --display-name "Magnus Carlsen" \
  --platform chesscom \
  --platform-username MagnusCarlsen \
  --category gm

# Step 2: Chess.com online games (auto-download platform)
python scripts/celebrity-download.py --player magnus-carlsen --import

# Step 3: Lichess games (manual — only one platform can be auto-downloaded)
# All games merge under the same slug regardless of source.
curl -H "Accept: application/x-chess-pgn" \
  "https://lichess.org/api/games/user/DrNykterstein" > /tmp/magnus-lichess.pgn
python scripts/celebrity-import.py /tmp/magnus-lichess.pgn \
  --player magnus-carlsen \
  --display-name "Magnus Carlsen"
```

### Hikaru Nakamura

- **PGN Mentor**: `Nakamura.zip` (~8,727 games)
- **Lichess**: None confirmed (primarily plays on Chess.com)
- **Chess.com**: `Hikaru` (confirmed GM, ~64K games)

```bash
# Step 1: OTB games from PGN Mentor
wget -P /tmp https://www.pgnmentor.com/players/Nakamura.zip
unzip -o /tmp/Nakamura.zip -d /tmp
python scripts/celebrity-import.py /tmp/Nakamura.pgn \
  --player hikaru-nakamura \
  --display-name "Hikaru Nakamura" \
  --platform chesscom \
  --platform-username Hikaru \
  --category gm

# Step 2: Chess.com online games
python scripts/celebrity-download.py --player hikaru-nakamura --import
```

### Fabiano Caruana

- **PGN Mentor**: `Caruana.zip` (~5,341 games)
- **Chess.com**: `FabianoCaruana` (confirmed GM)

```bash
# Step 1: OTB games from PGN Mentor
wget -P /tmp https://www.pgnmentor.com/players/Caruana.zip
unzip -o /tmp/Caruana.zip -d /tmp
python scripts/celebrity-import.py /tmp/Caruana.pgn \
  --player fabiano-caruana \
  --display-name "Fabiano Caruana" \
  --platform chesscom \
  --platform-username FabianoCaruana \
  --category gm

# Step 2: Chess.com online games
python scripts/celebrity-download.py --player fabiano-caruana --import
```

### Wesley So

- **PGN Mentor**: `So.zip`
- **Chess.com**: `GMWSO` (confirmed GM) -- NOT "WesleySo" (squatted)

```bash
# Step 1: OTB games from PGN Mentor
wget -P /tmp https://www.pgnmentor.com/players/So.zip
unzip -o /tmp/So.zip -d /tmp
python scripts/celebrity-import.py /tmp/So.pgn \
  --player wesley-so \
  --display-name "Wesley So" \
  --platform chesscom \
  --platform-username GMWSO \
  --category gm

# Step 2: Chess.com online games
python scripts/celebrity-download.py --player wesley-so --import
```

### Hans Niemann

- **PGN Mentor**: Not available
- **Chess.com**: `HansOnTwitch` (confirmed GM) -- NOT "HansNiemann" (squatted)

```bash
# No PGN Mentor file — register for online download only
python scripts/celebrity-import.py --register \
  --player hans-niemann \
  --display-name "Hans Niemann" \
  --platform chesscom \
  --platform-username HansOnTwitch \
  --category gm

# Download and import online games
python scripts/celebrity-download.py --player hans-niemann --import
```

### Dommaraju Gukesh

- **PGN Mentor**: `Gukesh.zip`
- **Chess.com**: `GukeshDommaraju` (confirmed GM)

```bash
# Step 1: OTB games from PGN Mentor
wget -P /tmp https://www.pgnmentor.com/players/Gukesh.zip
unzip -o /tmp/Gukesh.zip -d /tmp
python scripts/celebrity-import.py /tmp/Gukesh.pgn \
  --player gukesh \
  --display-name "Dommaraju Gukesh" \
  --platform chesscom \
  --platform-username GukeshDommaraju \
  --category gm

# Step 2: Chess.com online games
python scripts/celebrity-download.py --player gukesh --import
```

### Ding Liren

- **PGN Mentor**: `Ding.zip`
- **Online accounts**: No significant online presence

```bash
wget -P /tmp https://www.pgnmentor.com/players/Ding.zip
unzip -o /tmp/Ding.zip -d /tmp
python scripts/celebrity-import.py /tmp/Ding.pgn \
  --player ding-liren \
  --display-name "Ding Liren" \
  --platform pgn \
  --category gm
```

### Alireza Firouzja

- **PGN Mentor**: `Firouzja.zip`
- **Lichess**: `alireza2003` (confirmed GM, ~10K games)
- **Chess.com**: `alireza2003`

```bash
# Step 1: OTB games from PGN Mentor
wget -P /tmp https://www.pgnmentor.com/players/Firouzja.zip
unzip -o /tmp/Firouzja.zip -d /tmp
python scripts/celebrity-import.py /tmp/Firouzja.pgn \
  --player alireza-firouzja \
  --display-name "Alireza Firouzja" \
  --platform lichess \
  --platform-username alireza2003 \
  --category gm

# Step 2: Lichess online games
python scripts/celebrity-download.py --player alireza-firouzja --import
```

### Anish Giri

- **PGN Mentor**: `Giri.zip`
- **Chess.com**: `AnishGiri` (confirmed GM)

```bash
# Step 1: OTB games from PGN Mentor
wget -P /tmp https://www.pgnmentor.com/players/Giri.zip
unzip -o /tmp/Giri.zip -d /tmp
python scripts/celebrity-import.py /tmp/Giri.pgn \
  --player anish-giri \
  --display-name "Anish Giri" \
  --platform chesscom \
  --platform-username AnishGiri \
  --category gm

# Step 2: Chess.com online games
python scripts/celebrity-download.py --player anish-giri --import
```

### Rameshbabu Praggnanandhaa

- **PGN Mentor**: `Praggnanandhaa.zip`
- **Chess.com**: `rpragchess` (confirmed GM)

```bash
# Step 1: OTB games from PGN Mentor
wget -P /tmp https://www.pgnmentor.com/players/Praggnanandhaa.zip
unzip -o /tmp/Praggnanandhaa.zip -d /tmp
python scripts/celebrity-import.py /tmp/Praggnanandhaa.pgn \
  --player praggnanandhaa \
  --display-name "Rameshbabu Praggnanandhaa" \
  --platform chesscom \
  --platform-username rpragchess \
  --category gm

# Step 2: Chess.com online games
python scripts/celebrity-download.py --player praggnanandhaa --import
```

---

## Streamers & YouTubers

Most streamers don't have PGN Mentor files. They're imported via the Chess.com/Lichess download script.

### Levy Rozman (GothamChess)

- **PGN Mentor**: Not available
- **Chess.com**: `GothamChess` (confirmed IM, ~28K games)

```bash
python scripts/celebrity-import.py --register \
  --player levy-rozman \
  --display-name "Levy Rozman (GothamChess)" \
  --platform chesscom \
  --platform-username GothamChess \
  --category streamer

python scripts/celebrity-download.py --player levy-rozman --import
```

### Daniel Naroditsky

- **PGN Mentor**: Not available
- **Lichess**: `RebeccaHarris` (confirmed GM, ~17K games)
- **Chess.com**: `DanielNaroditsky` (confirmed GM, ~135K games)

```bash
python scripts/celebrity-import.py --register \
  --player daniel-naroditsky \
  --display-name "Daniel Naroditsky" \
  --platform chesscom \
  --platform-username DanielNaroditsky \
  --category streamer

python scripts/celebrity-download.py --player daniel-naroditsky --import
```

### Eric Rosen

- **PGN Mentor**: Not available
- **Lichess**: `EricRosen` (confirmed IM, ~40K games)
- **Chess.com**: `IMRosen`

```bash
python scripts/celebrity-import.py --register \
  --player eric-rosen \
  --display-name "Eric Rosen" \
  --platform lichess \
  --platform-username EricRosen \
  --category streamer

python scripts/celebrity-download.py --player eric-rosen --import
```

### Anna Cramling

- **PGN Mentor**: Not available
- **Lichess**: Disabled
- **Chess.com**: `AnnaCramling` (confirmed WFM)

```bash
python scripts/celebrity-import.py --register \
  --player anna-cramling \
  --display-name "Anna Cramling" \
  --platform chesscom \
  --platform-username AnnaCramling \
  --category streamer

python scripts/celebrity-download.py --player anna-cramling --import
```

### Alexandra Botez

- **PGN Mentor**: Not available
- **Chess.com**: `AlexandraBotez` (confirmed WFM)

```bash
python scripts/celebrity-import.py --register \
  --player alexandra-botez \
  --display-name "Alexandra Botez" \
  --platform chesscom \
  --platform-username AlexandraBotez \
  --category streamer

python scripts/celebrity-download.py --player alexandra-botez --import
```

### Chessbrah (Eric Hansen)

- **PGN Mentor**: Not available
- **Chess.com**: `Chessbrah` (confirmed GM, ~31K games)
- **Lichess**: Unknown (the `chessbrah` Lichess account is a placeholder with 128 games)

```bash
python scripts/celebrity-import.py --register \
  --player chessbrah \
  --display-name "Eric Hansen (Chessbrah)" \
  --platform chesscom \
  --platform-username Chessbrah \
  --category streamer

python scripts/celebrity-download.py --player chessbrah --import
```

### Ben Finegold

- **PGN Mentor**: `Finegold.zip`
- **Chess.com**: `GMBenjaminFinegold` (confirmed GM)

```bash
# Step 1: OTB games from PGN Mentor
wget -P /tmp https://www.pgnmentor.com/players/Finegold.zip
unzip -o /tmp/Finegold.zip -d /tmp
python scripts/celebrity-import.py /tmp/Finegold.pgn \
  --player ben-finegold \
  --display-name "Ben Finegold" \
  --platform chesscom \
  --platform-username GMBenjaminFinegold \
  --category streamer

# Step 2: Chess.com online games
python scripts/celebrity-download.py --player ben-finegold --import
```

### Dina Belenkaya

- **PGN Mentor**: Not available
- **Lichess**: Disabled
- **Chess.com**: `DinaBelenkaya` (confirmed WGM)

```bash
python scripts/celebrity-import.py --register \
  --player dina-belenkaya \
  --display-name "Dina Belenkaya" \
  --platform chesscom \
  --platform-username DinaBelenkaya \
  --category streamer

python scripts/celebrity-download.py --player dina-belenkaya --import
```

---

## Meme Picks

### Ludwig

- **PGN Mentor**: Not available
- **Chess.com**: `lud-skywalker`

```bash
python scripts/celebrity-import.py --register \
  --player ludwig \
  --display-name "Ludwig" \
  --platform chesscom \
  --platform-username lud-skywalker \
  --category meme

python scripts/celebrity-download.py --player ludwig --import
```

### MoistCr1TiKaL (Charlie)

- **PGN Mentor**: Not available
- **Chess.com**: `TurboFisto`

```bash
python scripts/celebrity-import.py --register \
  --player moistcr1tikal \
  --display-name "MoistCr1TiKaL (Charlie)" \
  --platform chesscom \
  --platform-username TurboFisto \
  --category meme

python scripts/celebrity-download.py --player moistcr1tikal --import
```

---

## Bulk Operations

### Download all online players at once

After all players are registered, fetch new games for everyone:

```bash
python scripts/celebrity-download.py --import
```

### Re-download everything (ignore watermarks)

```bash
python scripts/celebrity-download.py --full --import
```

### Check download status

```bash
python scripts/celebrity-download.py --status
```

### Export for distribution

After all imports are done, create the dumps for the Docker image (this writes all four,
including `celebrity-moves-dump.sql.gz`):

```bash
./scripts/data-export.sh --output-dir ./dumps
```

### Remove a player

```bash
python scripts/celebrity-import.py --clean --player <slug>
```

### Remove all celebrity data

```bash
python scripts/celebrity-import.py --clean-all
```

---

## Account Verification Quick Reference

| Player               | Platform | Username           | Verified |
| -------------------- | -------- | ------------------ | -------- |
| Bobby Fischer        | pgn      | —                  | Yes      |
| Garry Kasparov       | pgn      | —                  | Yes      |
| Anatoly Karpov       | pgn      | —                  | Yes      |
| Mikhail Tal          | pgn      | —                  | Yes      |
| Jose Raul Capablanca | pgn      | —                  | Yes      |
| Paul Morphy          | pgn      | —                  | Yes      |
| Frank Marshall       | pgn      | —                  | Yes      |
| Judit Polgar         | pgn      | —                  | Yes      |
| Susan Polgar         | pgn      | —                  | Yes      |
| Magnus Carlsen       | lichess  | DrNykterstein      | Yes      |
| Hikaru Nakamura      | chesscom | Hikaru             | Yes      |
| Fabiano Caruana      | chesscom | FabianoCaruana     | Yes      |
| Wesley So            | chesscom | GMWSO              | Yes      |
| Hans Niemann         | chesscom | HansOnTwitch       | Yes      |
| Dommaraju Gukesh     | chesscom | GukeshDommaraju    | Yes      |
| Ding Liren           | pgn      | —                  | Yes      |
| Alireza Firouzja     | lichess  | alireza2003        | Yes      |
| Anish Giri           | chesscom | AnishGiri          | Yes      |
| Praggnanandhaa       | chesscom | rpragchess         | Yes      |
| Levy Rozman          | chesscom | GothamChess        | Yes      |
| Daniel Naroditsky    | chesscom | DanielNaroditsky   | Yes      |
| Eric Rosen           | lichess  | EricRosen          | Yes      |
| Anna Cramling        | chesscom | AnnaCramling       | Yes      |
| Alexandra Botez      | chesscom | AlexandraBotez     | Yes      |
| Chessbrah            | chesscom | Chessbrah          | Yes      |
| Ben Finegold         | chesscom | GMBenjaminFinegold | Yes      |
| Dina Belenkaya       | chesscom | DinaBelenkaya      | Yes      |
| Ludwig               | chesscom | lud-skywalker      | Yes      |
| MoistCr1TiKaL        | chesscom | TurboFisto         | Yes      |
