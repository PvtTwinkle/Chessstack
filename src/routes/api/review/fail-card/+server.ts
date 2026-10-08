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
import { repertoire, userMove, userRepertoireMove } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { Rating } from '$lib/fsrs';
import { loadFsrsConfig } from '$lib/server/fsrs-config';
import { applyGrade } from '$lib/server/grading';
import { fenKey } from '$lib/fen';
import { isRepertoireLocked } from '$lib/stripe/tiers.server';
import { requireAuth } from '$lib/server/api-helpers';
import { parseBody } from '$lib/server/validation';
import { failCardSchema } from '$lib/server/schemas/review';

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireAuth(locals);

	const body = await parseBody(request, failCardSchema);
	const { repertoireId } = body;

	// Normalize to 4-field FEN so transpositions always match.
	const fromFen = fenKey(body.fromFen);

	// Repertoire check, card lookup, and FSRS config are independent — run in parallel.
	const [repRows, cardRows, fsrsConfig] = await Promise.all([
		db
			.select()
			.from(repertoire)
			.where(and(eq(repertoire.id, repertoireId), eq(repertoire.userId, user.id))),
		db
			.select()
			.from(userRepertoireMove)
			.where(
				and(
					eq(userRepertoireMove.userId, user.id),
					eq(userRepertoireMove.repertoireId, repertoireId),
					eq(userRepertoireMove.fromFen, fromFen)
				)
			),
		loadFsrsConfig(user.id)
	]);

	if (!repRows[0]) throw error(404, 'Repertoire not found');

	if (await isRepertoireLocked(user.id, repertoireId, user.tier ?? 'free')) {
		throw error(403, 'This repertoire is read-only. Upgrade your plan to edit it.');
	}

	const card = cardRows[0];

	const now = new Date();

	if (card) {
		// Card exists — apply Again rating via FSRS.
		const updated = await applyGrade(
			user.id,
			card,
			Rating.Again,
			'REVIEW_DEVIATION',
			fsrsConfig,
			now
		);
		return json({ updated: true, due: updated.due });
	}

	// No SR card exists — find the corresponding userMove to get the SAN,
	// then create a new card in an immediately-due state. The card has never
	// been shown, so this is not a grade and gets no review_log row.
	const [moveRow] = await db
		.select()
		.from(userMove)
		.where(
			and(
				eq(userMove.userId, user.id),
				eq(userMove.repertoireId, repertoireId),
				eq(userMove.fromFen, fromFen)
			)
		);

	if (!moveRow) {
		// No move at this position — can't create a card, but it's not an error.
		return json({ updated: false, reason: 'No move found for this position' });
	}

	await db.insert(userRepertoireMove).values({
		userId: user.id,
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
