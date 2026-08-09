-- 0026_gap_min_popularity_pct.sql
-- Add gap_min_popularity_pct column to user_settings.
-- Gap Finder now sources candidate moves from lichess_moves (players DB,
-- windowed around the trainer rating) instead of chessmont_moves (masters)
-- with a book-table fallback. This column is the minimum % of games at a
-- position a move must reach — alongside the existing gap_min_games sample
-- size floor — to be reported as a gap. Default 5 (5%).

ALTER TABLE user_settings ADD COLUMN gap_min_popularity_pct INTEGER NOT NULL DEFAULT 5;
