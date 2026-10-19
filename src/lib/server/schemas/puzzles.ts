// Request bodies for /api/puzzles routes.

import { z } from 'zod';
import { PUZZLE_ID_MAX_LENGTH, PUZZLE_MAX_ATTEMPT_MS } from '$lib/validation-limits';

/** POST /api/puzzles/attempt. timeMs is rounded to whole milliseconds. */
export const puzzleAttemptSchema = z.object({
	puzzleId: z.string().min(1).max(PUZZLE_ID_MAX_LENGTH),
	solved: z.boolean(),
	timeMs: z
		.number()
		.min(0)
		.max(PUZZLE_MAX_ATTEMPT_MS)
		.nullish()
		.transform((v) => (v == null ? null : Math.round(v)))
});
