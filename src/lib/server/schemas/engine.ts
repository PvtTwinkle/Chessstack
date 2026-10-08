// Request bodies for the position-lookup routes (/api/eco, /api/book).

import { z } from 'zod';
import { FEN_MAX_LENGTH } from '$lib/validation-limits';

const ECO_SHAPE = 'Request body must be { fens: string[] }';
const PIECE_PLACEMENT = /^[1-8pnbrqkPNBRQK/]+$/;
// A typical opening is 15–20 moves deep, so 50 positions is generous while
// keeping the lookup's IN clause small.
const MAX_ECO_FENS = 50;

/** A plausibly well-formed FEN: piece placement, side to move, 4–6 fields. */
function looksLikeFen(value: unknown): value is string {
	if (typeof value !== 'string' || value.length === 0 || value.length > FEN_MAX_LENGTH)
		return false;
	const parts = value.split(' ');
	if (parts.length < 4 || parts.length > 6) return false;
	return PIECE_PLACEMENT.test(parts[0]) && (parts[1] === 'w' || parts[1] === 'b');
}

/**
 * POST /api/eco. fens is the current position followed by the move history,
 * newest first. Entries that don't look like FENs are dropped rather than
 * rejected, since the list comes straight from the board.
 */
export const ecoLookupSchema = z.object(
	{
		fens: z
			.array(z.unknown(), { error: ECO_SHAPE })
			.transform((fens) => fens.filter(looksLikeFen).slice(0, MAX_ECO_FENS))
	},
	{ error: ECO_SHAPE }
);

/** POST /api/book. */
export const bookLookupSchema = z.object({
	fen: z
		.string({ error: 'fen is required or too long' })
		.trim()
		.min(1, { error: 'fen is required or too long' })
		.max(FEN_MAX_LENGTH, { error: 'fen is required or too long' })
});
