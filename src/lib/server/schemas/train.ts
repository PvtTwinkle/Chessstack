// Request bodies for /api/train routes.

import { z } from 'zod';
import {
	FEN_MAX_LENGTH,
	LEAD_IN_MAX_MOVES,
	NAME_MAX_LENGTH,
	PGN_MAX_BYTES,
	TRAIN_MAX_MOVES
} from '$lib/validation-limits';
import { id, san } from './common';

// Engine scores from the browser, White's perspective. Centipawn scores beyond
// ±100 pawns mean the same as a mate for the rating, so they're clamped there.
const MAX_EVAL_CP = 10_000;

/** POST /api/train/evaluate */
export const trainerEvaluateSchema = z.object({
	// The browser engine's score for the final position; both null when it
	// had none (engine unavailable, or no legal moves).
	evalCp: z
		.number()
		.transform((v) => Math.max(-MAX_EVAL_CP, Math.min(MAX_EVAL_CP, Math.round(v))))
		.nullish(),
	evalMate: z.number().int().nullish(),
	rated: z.boolean().optional(),
	repertoireId: id,
	pgn: z.string().min(1).max(PGN_MAX_BYTES),
	movesPlayed: z.number().int().min(0).max(TRAIN_MAX_MOVES),
	startFen: z.string().max(FEN_MAX_LENGTH),
	moveSource: z.enum(['PLAYERS', 'MASTERS']),
	playerColor: z.enum(['WHITE', 'BLACK']),
	// Players-mode rating bracket index (0-7, see $lib/ratings); null in Masters mode.
	ratingBracket: z.number().int().min(0).max(7).nullish()
});

/** POST /api/train/saved-positions */
export const savePositionSchema = z.object({
	fen: z
		.string({ error: 'Invalid FEN' })
		.trim()
		.min(1, { error: 'Invalid FEN' })
		.max(FEN_MAX_LENGTH, { error: 'Invalid FEN' }),
	name: z
		.string({ error: `Name must be 1-${NAME_MAX_LENGTH} characters` })
		.trim()
		.min(1, { error: `Name must be 1-${NAME_MAX_LENGTH} characters` })
		.max(NAME_MAX_LENGTH, { error: `Name must be 1-${NAME_MAX_LENGTH} characters` }),
	// SAN moves from the standard start position to this FEN.
	leadInMoves: z.array(san).max(LEAD_IN_MAX_MOVES).optional()
});

/** DELETE /api/train/saved-positions */
export const deletePositionSchema = z.object({ id });
