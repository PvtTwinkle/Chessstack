// POST /api/review/fail-card
//
// Apply an FSRS "Again" rating to the SR card for a specific repertoire position.
// Called from the game review page when the user identifies a DEVIATION — the
// deviation counts as a failed drill card, so the position will resurface soon.
//
// If no SR card exists for the given position (possible if the card was deleted,
// or predates FSRS), a new one is created in a due state so it appears promptly.
//
// A card already failed from Review in the last day isn't failed again: a retry
// after a half-finished action, or reviewing the same game twice, would
// otherwise grade one mistake as two lapses.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { repertoire, userMove, userRepertoireMove } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { Rating } from '$lib/fsrs';
import { loadFsrsConfig } from '$lib/server/fsrs-config';
import { applyGrade, REVIEW_FAIL_REPEAT_WINDOW_MS } from '$lib/server/grading';
import { fenKey } from '$lib/fen';
import { isRepertoireLocked } from '$lib/stripe/tiers.server';
import { requireAuth } from '$lib/server/api-helpers';
import { parseBody } from '$lib/server/validation';
import { failCardSchema } from '$lib/server/schemas/review';
import { newCard } from '$lib/server/repertoire-moves';

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
		const result = await applyGrade(
			user.id,
			card.id,
			Rating.Again,
			'REVIEW_DEVIATION',
			fsrsConfig,
			{
				now,
				skipIfRecent: { source: 'REVIEW_DEVIATION', withinMs: REVIEW_FAIL_REPEAT_WINDOW_MS }
			}
		);
		if (result.status === 'not_found') throw error(404, 'Card not found');
		if (result.status === 'skipped') {
			return json({ updated: false, due: result.due, reason: 'Already failed from Review today' });
		}
		return json({ updated: true, due: result.updated.due });
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

	// A second request racing this one may have created it already; one card is enough.
	await db
		.insert(userRepertoireMove)
		.values({ ...newCard(user.id, repertoireId, fromFen, moveRow.san), due: now })
		.onConflictDoNothing({
			target: [userRepertoireMove.repertoireId, userRepertoireMove.fromFen]
		});

	return json({ updated: true, due: now });
};
