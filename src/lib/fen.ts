// Shared FEN utilities — canonical source for FEN normalization and validation.
// All other modules should import from here instead of defining their own copies.

import { FEN_MAX_LENGTH } from '$lib/validation-limits';

/**
 * Strip the half-move clock and full-move counter from a FEN string.
 * Positions reached via different move orders compare equal if the first four
 * fields match (piece placement, active color, castling rights, en-passant).
 */
export function fenKey(fen: string): string {
	return fen.split(' ').slice(0, 4).join(' ');
}

/** The standard starting position FEN (4-field — no halfmove clock or fullmove counter). */
export const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';

/**
 * Ensure a FEN has all 6 fields (adding halfmove clock and fullmove counter
 * if only the 4-field fenKey format is provided). Chess.js requires all 6.
 */
export function toFullFen(fen: string): string {
	return fen.split(' ').length <= 4 ? `${fen} 0 1` : fen;
}

/**
 * Validates that a FEN string is plausibly well-formed and within length limits.
 * This is a lightweight check for input sanitization, not a full chess legality
 * check — Chess.js handles that when the FEN is actually used.
 *
 * Returns the trimmed FEN if valid, or null if it should be rejected.
 */
export function sanitizeFen(fen: unknown): string | null {
	if (typeof fen !== 'string') return null;
	const trimmed = fen.trim();
	if (trimmed.length === 0 || trimmed.length > FEN_MAX_LENGTH) return null;
	return trimmed;
}
