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
import { userRepertoireMove } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { gradeCard } from '$lib/fsrs';
import { isRepertoireLocked } from '$lib/stripe/tiers.server';
import { requireAuth } from '$lib/server/api-helpers';
import { parseBody } from '$lib/server/validation';
import { gradeCardSchema } from '$lib/server/schemas/drill';
import { loadFsrsConfig } from '$lib/server/fsrs-config';

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireAuth(locals);

	const { cardId, rating } = await parseBody(request, gradeCardSchema);

	// Load card + FSRS config in parallel — they are independent queries.
	const [cardRows, fsrsConfig] = await Promise.all([
		db
			.select()
			.from(userRepertoireMove)
			.where(and(eq(userRepertoireMove.id, cardId), eq(userRepertoireMove.userId, user.id))),
		loadFsrsConfig(user.id)
	]);

	const card = cardRows[0];
	if (!card) throw error(404, 'Card not found');

	if (await isRepertoireLocked(user.id, card.repertoireId, user.tier ?? 'free')) {
		throw error(403, 'This repertoire is read-only. Upgrade your plan to edit it.');
	}

	// Run the FSRS algorithm to get the updated memory state.
	const now = new Date();
	const updated = gradeCard(card, rating, now, fsrsConfig);

	// Write the new state back to the database.
	await db.update(userRepertoireMove).set(updated).where(eq(userRepertoireMove.id, cardId));

	return json({ updated: true, due: updated.due });
};
