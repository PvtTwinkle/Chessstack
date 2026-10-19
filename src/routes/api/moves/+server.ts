// GET  /api/moves?repertoireId=X  — load all saved moves for a repertoire
// POST /api/moves                  — save a new move to the repertoire
//
// The POST handler is where the core build-mode logic lives:
//
//   User's turn (repertoire color matches FEN active side):
//     • Only one move is allowed per position.
//     • Saving also creates a user_repertoire_move SR card (so it gets drilled).
//     • Returns 409 if a DIFFERENT move already exists from this position.
//     • Returns 200 with the existing row if the exact same move already exists.
//
//   Opponent's turn:
//     • Multiple moves are allowed (all lines the user wants to prepare for).
//     • No SR card is created (you drill your own responses, not the opponent's moves).
//     • Returns 200 with the existing row if the exact same move already exists.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { repertoire, userMove } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { isRepertoireLocked } from '$lib/stripe/tiers.server';
import { requireAuth, parseIntParam } from '$lib/server/api-helpers';
import { parseBody } from '$lib/server/validation';
import { createMoveSchema } from '$lib/server/schemas/moves';
import {
	addMove,
	lockRepertoire,
	playMove,
	type RepertoireColor
} from '$lib/server/repertoire-moves';

// ── GET ────────────────────────────────────────────────────────────────────────

export const GET: RequestHandler = async ({ locals, url }) => {
	const user = requireAuth(locals);

	const repertoireIdParam = url.searchParams.get('repertoireId');
	if (!repertoireIdParam) throw error(400, 'repertoireId query parameter is required');

	const repertoireId = parseIntParam(repertoireIdParam, 'repertoireId');

	// Verify this repertoire belongs to the requesting user before returning data.
	const [rep] = await db
		.select()
		.from(repertoire)
		.where(and(eq(repertoire.id, repertoireId), eq(repertoire.userId, user.id)));

	if (!rep) throw error(404, 'Repertoire not found');

	const moves = await db
		.select()
		.from(userMove)
		.where(and(eq(userMove.userId, user.id), eq(userMove.repertoireId, repertoireId)));

	return json(moves);
};

// ── POST ───────────────────────────────────────────────────────────────────────

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireAuth(locals);

	// toFen is intentionally NOT read from the body — we compute it server-side
	// by applying the move to fromFen. Accepting it from the client would allow
	// a crafted request to store an arbitrary FEN as the destination position,
	// corrupting the move tree.
	const body = await parseBody(request, createMoveSchema);
	const { repertoireId } = body;

	// Verify the repertoire exists and belongs to this user.
	const [rep] = await db
		.select()
		.from(repertoire)
		.where(and(eq(repertoire.id, repertoireId), eq(repertoire.userId, user.id)));

	if (!rep) throw error(404, 'Repertoire not found');

	if (await isRepertoireLocked(user.id, repertoireId, user.tier ?? 'free')) {
		throw error(403, 'This repertoire is read-only. Upgrade your plan to edit it.');
	}

	// Validates the move and computes the normalised positions (4-field FENs,
	// so transpositions match regardless of move order).
	const played = playMove(body.fromFen, body.san);
	if (!played) throw error(400, 'Invalid FEN or move');

	const result = await db.transaction(async (tx) => {
		await lockRepertoire(tx, repertoireId);
		return addMove(
			tx,
			{ userId: user.id, repertoireId, color: rep.color as RepertoireColor },
			{ ...played, source: 'PERSONAL' }
		);
	});

	switch (result.status) {
		case 'created':
			return json(result.move, { status: 201 });
		case 'exists':
			return json(result.move);
		case 'conflict':
			// The client uses this to show a warning and snap the board back.
			return json(
				{ message: 'A move already exists from this position', existing: result.existing },
				{ status: 409 }
			);
	}
};
