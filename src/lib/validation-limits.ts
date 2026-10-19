// Centralised validation limits used across API routes and form validation.
// Import from here instead of hardcoding magic numbers in individual routes.

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;
export const FEN_MAX_LENGTH = 100;
export const NOTES_MAX_LENGTH = 500;
export const MAX_CARDS_REVIEWED = 10_000;

// Ids are Postgres int4 serials. Anything above this can't exist and would
// otherwise reach the database as an out-of-range error (a 500).
export const MAX_DB_ID = 2_147_483_647;

// Repertoire, saved-position and prep names.
export const NAME_MAX_LENGTH = 100;
// The longest legal SAN is about 7 characters ("Qh4xe1+"); a little slack
// covers annotation glyphs some sources append.
export const SAN_MAX_LENGTH = 10;
// PGN pasted or uploaded for import, and a single game saved from Review or
// Train. The request body limit (BODY_SIZE_LIMIT, 2 MB) sits above this.
export const PGN_MAX_BYTES = 1024 * 1024;
// Moves in one import/execute request. The client sends a big import in
// chunks of this size, so no request comes near the body limit.
export const IMPORT_MAX_MOVES = 1000;
// Lichess and Chess.com handles are at most 25 characters.
export const PLATFORM_USERNAME_MAX_LENGTH = 25;
// A trainer game ends at the user's depth limit, so a few hundred plies is
// far beyond any real game.
export const TRAIN_MAX_MOVES = 500;
// Trainer saved positions per user, and the lead-in moves each one stores.
export const SAVED_POSITIONS_MAX = 200;
export const LEAD_IN_MAX_MOVES = 100;
// Puzzle ids are Lichess's five-character ids; an hour is far beyond any real attempt.
export const PUZZLE_ID_MAX_LENGTH = 16;
export const PUZZLE_MAX_ATTEMPT_MS = 60 * 60 * 1000;
// Moves a user can exclude from an opponent prep.
export const PREP_EXCLUDED_MOVES_MAX = 500;

// Opponent prep moves are uploaded in chunks; this is the most one request
// may carry.
export const PREP_UPLOAD_BATCH_MAX = 1000;

// Stockfish search depth range for every user. Below 15 the suggestions are
// too weak to trust; above 30 the extra engine time buys almost nothing.
export const MIN_STOCKFISH_DEPTH = 15;
export const MAX_STOCKFISH_DEPTH = 30;
// Seconds the engine may think per move.
export const MIN_STOCKFISH_TIMEOUT_S = 3;
export const MAX_STOCKFISH_TIMEOUT_S = 30;

// Settings ranges, shared by PATCH /api/settings (which clamps to them) and
// the Settings page controls. Defaults match the user_settings column defaults.

/** Column default for the engine depth (user_settings.stockfish_depth). */
export const DEFAULT_STOCKFISH_DEPTH = 15;

/** Seconds the engine may search before giving up. */
export const STOCKFISH_TIMEOUT_RANGE = {
	min: MIN_STOCKFISH_TIMEOUT_S,
	max: MAX_STOCKFISH_TIMEOUT_S,
	default: 10
} as const;

/** Seconds per move in tempo training. */
export const TEMPO_SECONDS_RANGE = { min: 3, max: 30, default: 10 } as const;

/** Milliseconds between auto-played moves. */
export const PLAYBACK_SPEED_RANGE = { min: 200, max: 2000, step: 50, default: 500 } as const;

/** FSRS desired retention, as a fraction. */
export const FSRS_RETENTION_RANGE = { min: 0.7, max: 0.97, step: 0.01, default: 0.9 } as const;

/** FSRS maximum interval, in days. */
export const FSRS_MAX_INTERVAL_RANGE = { min: 30, max: 3650, step: 5, default: 365 } as const;

/** FSRS relearning delay, in minutes. */
export const FSRS_RELEARNING_RANGE = { min: 1, max: 60, default: 10 } as const;

/** The opening trainer's Elo rating. */
export const TRAINER_RATING_RANGE = { min: 100, max: 3000 } as const;

/** Puzzles in the dashboard's puzzle goal. */
export const PUZZLE_GOAL_RANGE = { min: 1, max: 999 } as const;
