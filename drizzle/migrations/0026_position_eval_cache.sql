-- 0026_position_eval_cache.sql
-- Cache of Stockfish evaluations, keyed by (fen, depth). Populated lazily
-- the first time a position is viewed with an eval-coloring feature, not
-- pre-seeded. Not user-scoped: an engine eval is the same for everyone on
-- the instance, so it's shared across all users.

CREATE TABLE position_eval_cache (
  fen          TEXT NOT NULL,
  depth        INTEGER NOT NULL,
  eval_cp      INTEGER,
  eval_mate    INTEGER,
  computed_at  TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY (fen, depth)
);
