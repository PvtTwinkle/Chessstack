// POST /api/puzzles/attempt
//
// Records a puzzle attempt for the current user.
//
// Request body: { puzzleId: string, solved: boolean, timeMs?: number }
// Response:     { success: true }

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { puzzle, puzzleAttempt } from '$lib/db/schema';
import { requireAuth } from '$lib/server/api-helpers';
import { parseBody } from '$lib/server/validation';
import { puzzleAttemptSchema } from '$lib/server/schemas/puzzles';

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = requireAuth(locals);

	const { puzzleId, solved, timeMs } = await parseBody(request, puzzleAttemptSchema);

	// An unknown id would otherwise surface as a foreign-key violation and a 500.
	const [known] = await db
		.select({ id: puzzle.puzzleId })
		.from(puzzle)
		.where(eq(puzzle.puzzleId, puzzleId))
		.limit(1);
	if (!known) throw error(404, 'Puzzle not found');

	await db.insert(puzzleAttempt).values({
		userId: user.id,
		puzzleId,
		solved,
		timeMs,
		attemptedAt: new Date()
	});

	return json({ success: true });
};
