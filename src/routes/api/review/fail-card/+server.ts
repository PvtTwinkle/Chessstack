// POST /api/review/fail-card
//
// Apply an FSRS "Again" rating to the SR card for a specific repertoire position.
// Called from the game review page when the user identifies a DEVIATION — the
// deviation counts as a failed drill card, so the position will resurface soon.
//
// If no SR card exists for the given position (possible if the card was deleted,
// or predates FSRS), a new one is created in a due state so it appears promptly.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { repertoire, userMove, userRepertoireMove, reviewLog } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { gradeCard, buildReviewLogEntry, Rating } from '$lib/fsrs';
import { loadFsrsConfig } from '$lib/server/fsrs-config';
import { fenKey } from '$lib/fen';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) throw error(401, 'Not authenticated');
	const userId = locals.user.id;

	let body;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}
	const { repertoireId } = body;

	if (typeof repertoireId !== 'number') throw error(400, 'repertoireId must be a number');
	if (!body.fromFen || typeof body.fromFen !== 'string') throw error(400, 'fromFen is required');
	if (body.fromFen.length > 100) throw error(400, 'fromFen is too long');

	// Normalize to 4-field FEN so transpositions always match.
	const fromFen = fenKey(body.fromFen);

	// Repertoire check, card lookup, and FSRS config are independent — run in parallel.
	const [repRows, cardRows, fsrsConfig] = await Promise.all([
		db
			.select()
			.from(repertoire)
			.where(and(eq(repertoire.id, repertoireId), eq(repertoire.userId, userId))),
		db
			.select()
			.from(userRepertoireMove)
			.where(
				and(
					eq(userRepertoireMove.userId, userId),
					eq(userRepertoireMove.repertoireId, repertoireId),
					eq(userRepertoireMove.fromFen, fromFen)
				)
			),
		loadFsrsConfig(userId)
	]);

	if (!repRows[0]) throw error(404, 'Repertoire not found');
	const card = cardRows[0];

	const now = new Date();

	if (card) {
		// Card exists — apply Again rating via FSRS.
		const updated = gradeCard(card, Rating.Again, now, fsrsConfig);
		const logEntry = buildReviewLogEntry(
			card,
			Rating.Again,
			updated,
			now,
			'REVIEW_DEVIATION',
			fsrsConfig
		);
		await db.transaction(async (tx) => {
			await tx.update(userRepertoireMove).set(updated).where(eq(userRepertoireMove.id, card.id));
			await tx.insert(reviewLog).values({ userId, cardId: card.id, ...logEntry });
		});
		return json({ updated: true, due: updated.due });
	}

	// No SR card exists — find the corresponding userMove to get the SAN,
	// then create a new card in an immediately-due state. This is card
	// creation, not a graded review (the card has never been shown to the
	// user yet), so no review_log entry is written here.
	const [moveRow] = await db
		.select()
		.from(userMove)
		.where(
			and(
				eq(userMove.userId, userId),
				eq(userMove.repertoireId, repertoireId),
				eq(userMove.fromFen, fromFen)
			)
		);

	if (!moveRow) {
		// No move at this position — can't create a card, but it's not an error.
		return json({ updated: false, reason: 'No move found for this position' });
	}

	await db.insert(userRepertoireMove).values({
		userId,
		repertoireId,
		fromFen,
		san: moveRow.san,
		due: now,
		state: 0, // New — will enter the learning phase on first drill
		reps: 0,
		lapses: 0,
		stability: null,
		difficulty: null,
		elapsedDays: null,
		scheduledDays: null,
		lastReview: null,
		learningSteps: 0
	});

	return json({ updated: true, due: now });
};
