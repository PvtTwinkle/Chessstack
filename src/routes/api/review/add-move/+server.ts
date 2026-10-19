// POST /api/review/add-move
//
// Add a move to the user's repertoire from the game review page.
// Called for:
//   Case 2 (BEYOND_REPERTOIRE): user wants to add the move they played, or the
//     engine's suggestion, at a position they haven't mapped yet.
//   Case 3 (OPPONENT_SURPRISE): user wants to add the opponent's surprise move
//     and/or their own response to it.
//
// The optional `forceReplace` flag handles Case 1 (DEVIATION): when true, if a
// *different* move already exists from this position, it is replaced rather
// than answered with a 409 conflict: the move gets a fresh drill card, and the
// line that only the old move led to is removed.
//
// The writes go through $lib/server/repertoire-moves, like POST /api/moves.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { repertoire } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { isRepertoireLocked } from '$lib/stripe/tiers.server';
import { requireAuth } from '$lib/server/api-helpers';
import { parseBody } from '$lib/server/validation';
import { reviewAddMoveSchema } from '$lib/server/schemas/review';
import {
	addMove,
	lockRepertoire,
	playMove,
	replaceMove,
	type RepertoireColor
} from '$lib/server/repertoire-moves';

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireAuth(locals);

	const body = await parseBody(request, reviewAddMoveSchema);
	const { repertoireId, san, forceReplace } = body;

	// Verify the repertoire belongs to this user.
	const [rep] = await db
		.select()
		.from(repertoire)
		.where(and(eq(repertoire.id, repertoireId), eq(repertoire.userId, user.id)));
	if (!rep) throw error(404, 'Repertoire not found');

	if (await isRepertoireLocked(user.id, repertoireId, user.tier ?? 'free')) {
		throw error(403, 'This repertoire is read-only. Upgrade your plan to edit it.');
	}

	// Compute toFen server-side (never accepted from the client — prevents crafted
	// requests from corrupting the move tree with arbitrary FENs).
	const played = playMove(body.fromFen, san);
	if (!played) throw error(400, 'Invalid FEN or illegal move');

	const target = { userId: user.id, repertoireId, color: rep.color as RepertoireColor };
	const move = { ...played, source: 'PERSONAL' };

	const result = await db.transaction(async (tx) => {
		await lockRepertoire(tx, repertoireId);
		const added = await addMove(tx, target, move);
		if (added.status !== 'conflict' || !forceReplace) return added;
		// The user chose the move they played over the one in their repertoire.
		return {
			status: 'replaced' as const,
			move: await replaceMove(tx, target, added.existing, move)
		};
	});

	switch (result.status) {
		case 'created':
			return json(result.move, { status: 201 });
		case 'exists':
		case 'replaced':
			return json(result.move);
		case 'conflict':
			return json(
				{
					message: 'A different move already exists from this position',
					existing: result.existing
				},
				{ status: 409 }
			);
	}
};
