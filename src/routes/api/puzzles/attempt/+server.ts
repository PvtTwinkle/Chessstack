// POST /api/puzzles/attempt
//
// Records a puzzle attempt for the current user.
//
// Request body: { puzzleId: string, solved: boolean, timeMs?: number }
// Response:     { success: true }

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { puzzleAttempt } from '$lib/db/schema';
import { requireAuth } from '$lib/server/api-helpers';
import { parseBody } from '$lib/server/validation';
import { puzzleAttemptSchema } from '$lib/server/schemas/puzzles';

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = requireAuth(locals);

	const { puzzleId, solved, timeMs } = await parseBody(request, puzzleAttemptSchema);

	await db.insert(puzzleAttempt).values({
		userId: user.id,
		puzzleId,
		solved,
		timeMs,
		attemptedAt: new Date()
	});

	return json({ success: true });
};
