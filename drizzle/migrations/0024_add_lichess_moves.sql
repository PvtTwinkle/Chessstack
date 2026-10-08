CREATE TABLE lichess_moves (
    position_fen    TEXT    NOT NULL,
    move_san        TEXT    NOT NULL,
    rating_bracket  INTEGER NOT NULL,
    resulting_fen   TEXT    NOT NULL,
    games_played    INTEGER NOT NULL DEFAULT 0,
    white_wins      INTEGER NOT NULL DEFAULT 0,
    black_wins      INTEGER NOT NULL DEFAULT 0,
    draws           INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (position_fen, move_san, rating_bracket)
);
--> statement-breakpoint
CREATE INDEX idx_lichess_position_bracket ON lichess_moves (position_fen, rating_bracket);
--> statement-breakpoint
ALTER TABLE user_settings ADD COLUMN players_rating_bracket INTEGER NOT NULL DEFAULT 3;
