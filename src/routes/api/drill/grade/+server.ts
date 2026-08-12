// POST /api/drill/grade — apply a rating to a drill card and update its SR state.
//
// The client sends the card ID and the user's rating (Forgot=1, Unsure=3, Easy=4).
// We load the card, run the FSRS algorithm to compute the next due date and
// updated memory state, then write the result back to user_repertoire_move.
//
// The card must belong to the requesting user — we verify ownership before
// touching anything.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { userRepertoireMove, reviewLog } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { gradeCard, buildReviewLogEntry, Rating } from '$lib/fsrs';
import { loadFsrsConfig } from '$lib/server/fsrs-config';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) throw error(401, 'Not authenticated');
	const userId = locals.user.id;

	let body;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}
	const { cardId, rating } = body;

	// Validate inputs.
	if (typeof cardId !== 'number') throw error(400, 'cardId must be a number');
	if (![Rating.Again, Rating.Good, Rating.Easy].includes(rating)) {
		throw error(400, 'rating must be 1 (Forgot), 3 (Unsure), or 4 (Easy)');
	}

	// Load card + FSRS config in parallel — they are independent queries.
	const [cardRows, fsrsConfig] = await Promise.all([
		db
			.select()
			.from(userRepertoireMove)
			.where(and(eq(userRepertoireMove.id, cardId), eq(userRepertoireMove.userId, userId))),
		loadFsrsConfig(userId)
	]);

	const card = cardRows[0];
	if (!card) throw error(404, 'Card not found');

	// Run the FSRS algorithm to get the updated memory state.
	const now = new Date();
	const updated = gradeCard(card, rating as Rating, now, fsrsConfig);
	const logEntry = buildReviewLogEntry(card, rating as Rating, updated, now, 'DRILL', fsrsConfig);

	// Write the new state back to the database, and append the review log
	// entry, in the same transaction so the two never drift out of sync.
	await db.transaction(async (tx) => {
		await tx.update(userRepertoireMove).set(updated).where(eq(userRepertoireMove.id, cardId));
		await tx.insert(reviewLog).values({ userId, cardId, ...logEntry });
	});

	return json({ updated: true, due: updated.due });
};
