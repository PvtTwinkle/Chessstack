// Request bodies for /api/review routes.

import { z } from 'zod';
import { FEN_MAX_LENGTH } from '$lib/validation-limits';
import { fen, id } from './common';

/**
 * POST /api/review/add-move. forceReplace swaps out a different move the
 * user already has at this position instead of answering 409.
 */
export const reviewAddMoveSchema = z.object({
	repertoireId: id,
	fromFen: fen,
	san: z.string().min(1),
	forceReplace: z.boolean().default(false)
});

/** POST /api/review/fail-card */
export const failCardSchema = z.object({
	repertoireId: id,
	fromFen: fen
});

/** POST /api/review/save. Blank notes are stored as null. */
export const saveReviewSchema = z.object({
	repertoireId: id,
	pgn: z.string().min(1),
	deviationFen: z.string().max(FEN_MAX_LENGTH).nullish(),
	notes: z
		.string()
		.trim()
		.nullish()
		.transform((v) => v || null),
	importedGameId: id.nullish()
});
