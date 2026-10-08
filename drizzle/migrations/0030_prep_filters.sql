-- 0023_prep_filters.sql
-- Add filtering columns to opponent_preps for min games threshold
-- and manual move exclusion.

ALTER TABLE opponent_preps ADD COLUMN min_games INTEGER NOT NULL DEFAULT 2;
--> statement-breakpoint

ALTER TABLE opponent_preps ADD COLUMN excluded_moves TEXT;
