-- 0022_opponent_prep.sql
-- Add opponent prep tables for tournament preparation mode.
-- Three new tables: opponent_preps (prep sessions), opponent_moves (aggregated
-- move stats from opponent's games), and prep_moves (user's sandboxed responses).

CREATE TABLE opponent_preps (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  opponent_name     TEXT NOT NULL,
  platform          TEXT NOT NULL,
  platform_username TEXT NOT NULL,
  time_window       TEXT,
  games_as_white    INTEGER NOT NULL DEFAULT 0,
  games_as_black    INTEGER NOT NULL DEFAULT 0,
  last_fetched_at   TIMESTAMP NOT NULL,
  created_at        TIMESTAMP NOT NULL
);
--> statement-breakpoint

CREATE INDEX idx_opponent_preps_user_id ON opponent_preps (user_id);
--> statement-breakpoint

CREATE TABLE opponent_moves (
  prep_id         INTEGER NOT NULL REFERENCES opponent_preps(id) ON DELETE CASCADE,
  position_fen    TEXT NOT NULL,
  move_san        TEXT NOT NULL,
  opponent_color  TEXT NOT NULL,
  resulting_fen   TEXT NOT NULL,
  games_played    INTEGER NOT NULL DEFAULT 0,
  white_wins      INTEGER NOT NULL DEFAULT 0,
  black_wins      INTEGER NOT NULL DEFAULT 0,
  draws           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (prep_id, position_fen, move_san, opponent_color)
);
--> statement-breakpoint

CREATE INDEX idx_opponent_moves_position_color ON opponent_moves (prep_id, position_fen, opponent_color);
--> statement-breakpoint

CREATE TABLE prep_moves (
  id          SERIAL PRIMARY KEY,
  prep_id     INTEGER NOT NULL REFERENCES opponent_preps(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  from_fen    TEXT NOT NULL,
  to_fen      TEXT NOT NULL,
  san         TEXT NOT NULL,
  color       TEXT NOT NULL,
  created_at  TIMESTAMP NOT NULL
);
--> statement-breakpoint

CREATE INDEX idx_prep_moves_prep_from_fen ON prep_moves (prep_id, from_fen);
