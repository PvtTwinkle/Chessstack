// Request bodies for /api/review routes.

import { z } from 'zod';
import { FEN_MAX_LENGTH, NOTES_MAX_LENGTH, PGN_MAX_BYTES } from '$lib/validation-limits';
import { fen, id, san } from './common';

/**
 * POST /api/review/add-move. forceReplace swaps out a different move the
 * user already has at this position instead of answering 409.
 */
export const reviewAddMoveSchema = z.object({
	repertoireId: id,
	fromFen: fen,
	san,
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
	pgn: z.string().min(1).max(PGN_MAX_BYTES),
	deviationFen: z.string().max(FEN_MAX_LENGTH).nullish(),
	notes: z
		.string()
		.trim()
		.max(NOTES_MAX_LENGTH, { error: `notes must be ${NOTES_MAX_LENGTH} characters or fewer` })
		.nullish()
		.transform((v) => v || null),
	importedGameId: id.nullish()
});
