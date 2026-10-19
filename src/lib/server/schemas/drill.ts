// Request bodies for /api/drill routes.

import { z } from 'zod';
import { Rating } from '$lib/fsrs';
import { id } from './common';

/** POST /api/drill/grade. sessionId is the drill session whose counts the grade adds to. */
export const gradeCardSchema = z.object({
	cardId: id,
	rating: z.literal([Rating.Again, Rating.Good, Rating.Easy], {
		error: 'rating must be 1 (Forgot), 3 (Unsure), or 4 (Easy)'
	}),
	sessionId: id.nullish().transform((v) => v ?? null)
});

/** POST /api/drill/session */
export const startDrillSessionSchema = z.object({ repertoireId: id });

// FSRS snapshot fields are null for a card that has never been reviewed.
const optionalNumber = (min: number, max?: number) => {
	const n = max === undefined ? z.number().min(min) : z.number().min(min).max(max);
	return n.nullish().transform((v) => v ?? null);
};
const optionalInt = (min: number, max?: number) => {
	const n = max === undefined ? z.number().int().min(min) : z.number().int().min(min).max(max);
	return n.nullish().transform((v) => v ?? null);
};
const optionalDate = (field: string) =>
	z
		.string()
		.refine((v) => !isNaN(new Date(v).getTime()), {
			error: `previousState.${field} must be a valid date`
		})
		.nullish()
		.transform((v) => (v == null ? null : new Date(v)));

/**
 * POST /api/drill/undo. reviewedAt is what the grade being undone returned;
 * previousState is the card's FSRS state captured by the client before
 * grading, and every field is range-checked before it is written back.
 */
export const undoGradeSchema = z.object({
	cardId: id,
	reviewedAt: z
		.string()
		.refine((v) => !isNaN(new Date(v).getTime()), { error: 'reviewedAt must be a valid date' })
		.transform((v) => new Date(v)),
	sessionId: id.nullish().transform((v) => v ?? null),
	previousState: z.object({
		stability: optionalNumber(0),
		difficulty: optionalNumber(0, 10),
		elapsedDays: optionalInt(0),
		scheduledDays: optionalInt(0),
		reps: optionalInt(0),
		lapses: optionalInt(0),
		state: optionalInt(0, 3),
		due: optionalDate('due'),
		lastReview: optionalDate('lastReview'),
		learningSteps: optionalInt(0).transform((v) => v ?? 0)
	})
});
