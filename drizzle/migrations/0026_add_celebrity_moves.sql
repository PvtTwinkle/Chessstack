CREATE TABLE star_players (
    slug              TEXT PRIMARY KEY,
    display_name      TEXT NOT NULL,
    platform          TEXT,
    platform_username TEXT
);
--> statement-breakpoint
CREATE TABLE celebrity_moves (
    position_fen    TEXT    NOT NULL,
    move_san        TEXT    NOT NULL,
    player_slug     TEXT    NOT NULL,
    resulting_fen   TEXT    NOT NULL,
    games_played    INTEGER NOT NULL DEFAULT 0,
    white_wins      INTEGER NOT NULL DEFAULT 0,
    black_wins      INTEGER NOT NULL DEFAULT 0,
    draws           INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (position_fen, move_san, player_slug)
);
--> statement-breakpoint
CREATE INDEX idx_celebrity_position_player ON celebrity_moves (position_fen, player_slug);
--> statement-breakpoint
ALTER TABLE user_settings ADD COLUMN stars_player_slug TEXT;