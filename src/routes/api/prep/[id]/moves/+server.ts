// POST   /api/prep/:id/moves — add a user's prep response move
// DELETE /api/prep/:id/moves — remove a prep move by ID, with the prep moves
//                               after it that no other line reaches
//
// Prep moves are sandboxed — they live in prep_moves, completely separate
// from the user's real repertoire moves. No SR cards are created.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { Chess } from 'chess.js';
import { db } from '$lib/db';
import { opponentPreps, opponentMoves, prepMoves } from '$lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { fenKey, STARTING_FEN } from '$lib/fen';
import { prepSubtreeIds } from '$lib/prep/subtree';
import { walkableEdges } from '$lib/server/prep-connect';
import { parseBody } from '$lib/server/validation';
import { addPrepMoveSchema, deletePrepMoveSchema } from '$lib/server/schemas/prep';
import { requireAuth, parseIntParam } from '$lib/server/api-helpers';

// ── POST ─────────────────────────────────────────────────────────────────────

export const POST: RequestHandler = async ({ locals, params, request }) => {
	const user = requireAuth(locals);

	const prepId = parseIntParam(params.id, 'prep ID');

	const body = await parseBody(request, addPrepMoveSchema);
	const { san, color } = body;
	const fromFen = fenKey(body.fromFen);

	// Verify prep ownership
	const [prep] = await db
		.select({ id: opponentPreps.id })
		.from(opponentPreps)
		.where(and(eq(opponentPreps.id, prepId), eq(opponentPreps.userId, user.id)));

	if (!prep) throw error(404, 'Prep not found');

	// Compute toFen server-side (never trust client)
	let toFen: string;
	try {
		const chess = new Chess(fromFen);
		const result = chess.move(san);
		if (!result) throw new Error('Illegal move');
		toFen = fenKey(chess.fen());
	} catch {
		throw error(400, 'Invalid FEN or move');
	}

	// Determine if this is the user's turn — only one move per position allowed
	try {
		const chess = new Chess(fromFen);
		const fenTurn = chess.turn();
		const isUserTurn =
			(color === 'white' && fenTurn === 'w') || (color === 'black' && fenTurn === 'b');

		if (isUserTurn) {
			// Check if ANY move already exists at this position for this color
			const [existingAtPosition] = await db
				.select()
				.from(prepMoves)
				.where(
					and(
						eq(prepMoves.prepId, prepId),
						eq(prepMoves.fromFen, fromFen),
						eq(prepMoves.color, color)
					)
				);

			if (existingAtPosition) {
				if (existingAtPosition.san === san) {
					// Exact same move — idempotent, return it
					return json(existingAtPosition);
				}
				// Different move — conflict, signal 409
				return json(
					{
						message: 'A prep move already exists from this position',
						existing: existingAtPosition
					},
					{ status: 409 }
				);
			}
		}
	} catch {
		// If FEN is invalid for Chess.js, fall through to the insert
	}

	// Check, then insert. There is no unique index on prep_moves, so two
	// requests racing past this check can still both insert; the cost is a
	// duplicate row in a sandboxed prep, which the client tolerates.
	const result = await db.transaction(async (tx) => {
		const [existing] = await tx
			.select()
			.from(prepMoves)
			.where(
				and(
					eq(prepMoves.prepId, prepId),
					eq(prepMoves.fromFen, fromFen),
					eq(prepMoves.san, san),
					eq(prepMoves.color, color)
				)
			);

		if (existing) return { move: existing, created: false };

		const [saved] = await tx
			.insert(prepMoves)
			.values({
				prepId,
				userId: user.id,
				fromFen,
				toFen,
				san,
				color,
				createdAt: new Date()
			})
			.returning();

		return { move: saved, created: true };
	});

	return json(result.move, { status: result.created ? 201 : 200 });
};

// ── DELETE ───────────────────────────────────────────────────────────────────

export const DELETE: RequestHandler = async ({ locals, request }) => {
	const user = requireAuth(locals);

	const { moveId } = await parseBody(request, deletePrepMoveSchema);

	// Verify the move belongs to this user
	const [move] = await db
		.select()
		.from(prepMoves)
		.where(and(eq(prepMoves.id, moveId), eq(prepMoves.userId, user.id)));

	if (!move) throw error(404, 'Prep move not found');

	// The moves after it go too, unless another line on the prep board still
	// reaches them; left behind they'd be copied into repertoires by export
	// and add-to-repertoire where nothing leads to them.
	const [sameColor, oppMoves] = await Promise.all([
		db
			.select()
			.from(prepMoves)
			.where(and(eq(prepMoves.prepId, move.prepId), eq(prepMoves.color, move.color))),
		db.select().from(opponentMoves).where(eq(opponentMoves.prepId, move.prepId))
	]);
	const walkable = await walkableEdges(
		user.id,
		move.color === 'white' ? 'WHITE' : 'BLACK',
		oppMoves
	);
	const ids = prepSubtreeIds(STARTING_FEN, sameColor, walkable, moveId);

	await db
		.delete(prepMoves)
		.where(and(eq(prepMoves.prepId, move.prepId), inArray(prepMoves.id, ids)));

	return json({ deleted: true, ids });
};
