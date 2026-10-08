// Centralised validation limits used across API routes and form validation.
// Import from here instead of hardcoding magic numbers in individual routes.

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;
export const FEN_MAX_LENGTH = 100;
export const NOTES_MAX_LENGTH = 500;
export const MAX_CARDS_REVIEWED = 10_000;

// Stockfish search depth range for every user. Below 15 the suggestions are
// too weak to trust; above 30 the extra engine time buys almost nothing.
export const MIN_STOCKFISH_DEPTH = 15;
export const MAX_STOCKFISH_DEPTH = 30;
