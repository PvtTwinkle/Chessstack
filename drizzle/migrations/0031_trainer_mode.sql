-- 0024_trainer_mode.sql
-- Add opening trainer tables and trainerRating column on user_settings.
-- Two new tables: trainer_session (completed training games) and
-- trainer_saved_position (reusable starting positions).

ALTER TABLE user_settings ADD COLUMN trainer_rating INTEGER;
--> statement-breakpoint

CREATE TABLE trainer_session (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  repertoire_id   INTEGER NOT NULL REFERENCES repertoire(id) ON DELETE CASCADE,
  start_fen       TEXT NOT NULL,
  pgn             TEXT NOT NULL,
  moves_played    INTEGER NOT NULL,
  final_eval_cp   INTEGER,
  rated           BOOLEAN NOT NULL,
  rating_before   INTEGER,
  rating_after    INTEGER,
  move_source     TEXT NOT NULL,
  completed_at    TIMESTAMP NOT NULL
);
--> statement-breakpoint

CREATE INDEX idx_trainer_session_user_id ON trainer_session (user_id);
--> statement-breakpoint

CREATE TABLE trainer_saved_position (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  fen         TEXT NOT NULL,
  name        TEXT NOT NULL,
  created_at  TIMESTAMP NOT NULL,
  UNIQUE (user_id, fen)
);
--> statement-breakpoint

CREATE INDEX idx_trainer_saved_position_user_id ON trainer_saved_position (user_id);
