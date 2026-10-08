// Request bodies for /api/train routes.

import { z } from 'zod';
import { FEN_MAX_LENGTH } from '$lib/validation-limits';
import { fen, id } from './common';

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
	fen,
	rated: z.boolean().optional(),
	repertoireId: id,
	pgn: z.string().min(1),
	movesPlayed: z.number().int().min(0),
	startFen: z.string().max(FEN_MAX_LENGTH),
	moveSource: z.enum(['PLAYERS', 'MASTERS']),
	playerColor: z.enum(['WHITE', 'BLACK']),
	// Players-mode rating bracket; null in Masters mode.
	ratingBracket: z.number().int().nullish()
});

/** POST /api/train/saved-positions */
export const savePositionSchema = z.object({
	fen: z
		.string({ error: 'Invalid FEN' })
		.trim()
		.min(1, { error: 'Invalid FEN' })
		.max(FEN_MAX_LENGTH, { error: 'Invalid FEN' }),
	name: z
		.string({ error: 'Name must be 1-100 characters' })
		.trim()
		.min(1, { error: 'Name must be 1-100 characters' })
		.max(100, { error: 'Name must be 1-100 characters' }),
	// SAN moves from the standard start position to this FEN.
	leadInMoves: z.array(z.string()).optional()
});

/** DELETE /api/train/saved-positions */
export const deletePositionSchema = z.object({ id });
