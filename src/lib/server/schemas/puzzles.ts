// Request bodies for /api/puzzles routes.

import { z } from 'zod';

/** POST /api/puzzles/attempt. timeMs is rounded to whole milliseconds. */
export const puzzleAttemptSchema = z.object({
	puzzleId: z.string().min(1),
	solved: z.boolean(),
	timeMs: z
		.number()
		.nullish()
		.transform((v) => (v == null ? null : Math.round(v)))
});
