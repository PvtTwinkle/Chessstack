// Request bodies for /api/moves routes.

import { z } from 'zod';
import { NOTES_MAX_LENGTH } from '$lib/validation-limits';
import { fen, id } from './common';

/**
 * POST /api/moves. There is deliberately no toFen: the server computes it by
 * playing san from fromFen, so a crafted request cannot store an arbitrary
 * destination position.
 */
export const createMoveSchema = z.object({
	repertoireId: id,
	fromFen: fen,
	san: z.string().min(1)
});

/** PATCH /api/moves/[id]. An empty or blank note is stored as null. */
export const updateMoveNotesSchema = z.object({
	notes: z
		.string()
		.trim()
		.max(NOTES_MAX_LENGTH, { error: `notes must be ${NOTES_MAX_LENGTH} characters or fewer` })
		.nullable()
		.transform((notes) => (notes === '' ? null : notes))
});
