// POST /api/drill/undo — restore a drill card's FSRS state to its pre-grade snapshot.
//
// When a user grades a card and immediately regrets it (before clicking "Next"),
// the client sends back the snapshot of FSRS fields it captured before grading.
// We validate ownership and write those fields back, effectively undoing the grade.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { userRepertoireMove } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { isRepertoireLocked } from '$lib/stripe/tiers.server';
import { requireAuth } from '$lib/server/api-helpers';
import { parseBody } from '$lib/server/validation';
import { undoGradeSchema } from '$lib/server/schemas/drill';

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireAuth(locals);

	// The schema range-checks every FSRS field before it is written back.
	const { cardId, previousState: validated } = await parseBody(request, undoGradeSchema);

	// Verify the card belongs to this user.
	const [card] = await db
		.select({ id: userRepertoireMove.id, repertoireId: userRepertoireMove.repertoireId })
		.from(userRepertoireMove)
		.where(and(eq(userRepertoireMove.id, cardId), eq(userRepertoireMove.userId, user.id)));

	if (!card) throw error(404, 'Card not found');

	if (await isRepertoireLocked(user.id, card.repertoireId, user.tier ?? 'free')) {
		throw error(403, 'This repertoire is read-only. Upgrade your plan to edit it.');
	}

	// Restore the pre-grade FSRS fields using validated values.
	await db.update(userRepertoireMove).set(validated).where(eq(userRepertoireMove.id, cardId));

	return json({ restored: true });
};
