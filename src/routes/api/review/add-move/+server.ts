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
// *different* move already exists from this position, update it rather than
// returning a 409 conflict. The FSRS card's SAN is updated accordingly.
//
// Core logic mirrors POST /api/moves to keep behaviour consistent.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { Chess } from 'chess.js';
import { db } from '$lib/db';
import { repertoire, userMove, userRepertoireMove } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { fenKey } from '$lib/fen';
import { isRepertoireLocked } from '$lib/stripe/tiers.server';
import { requireAuth } from '$lib/server/api-helpers';
import { parseBody } from '$lib/server/validation';
import { reviewAddMoveSchema } from '$lib/server/schemas/review';

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireAuth(locals);

	const body = await parseBody(request, reviewAddMoveSchema);
	const { repertoireId, san, forceReplace } = body;

	// Normalize to 4-field FEN so transpositions always match.
	const fromFen = fenKey(body.fromFen);

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
	let isUserTurn: boolean;
	let toFen: string;
	try {
		const chess = new Chess(fromFen);
		const fenTurn = chess.turn(); // 'w' or 'b'
		isUserTurn =
			(rep.color === 'WHITE' && fenTurn === 'w') || (rep.color === 'BLACK' && fenTurn === 'b');
		const result = chess.move(san);
		if (!result) throw new Error('Illegal move');
		toFen = fenKey(chess.fen());
	} catch {
		throw error(400, 'Invalid FEN or illegal move');
	}

	if (isUserTurn) {
		const [existing] = await db
			.select()
			.from(userMove)
			.where(and(eq(userMove.repertoireId, repertoireId), eq(userMove.fromFen, fromFen)));

		if (existing) {
			if (existing.san === san) {
				// Exact same move already exists — idempotent.
				return json(existing);
			}

			if (!forceReplace) {
				// Different move exists and we're not replacing — signal conflict.
				return json(
					{ error: 'A different move already exists from this position', existing },
					{ status: 409 }
				);
			}

			// forceReplace: update the existing move to the new san and toFen.
			// The old toFen's subtree is orphaned but not deleted — the user can
			// clean it up in Build mode if needed.
			// Both writes are in a transaction so they succeed or roll back together.
			await db.transaction(async (tx) => {
				await tx
					.update(userMove)
					.set({ san, toFen, source: 'PERSONAL' })
					.where(eq(userMove.id, existing.id));

				// Update the SR card's SAN to match the new move.
				await tx
					.update(userRepertoireMove)
					.set({ san })
					.where(
						and(
							eq(userRepertoireMove.userId, user.id),
							eq(userRepertoireMove.repertoireId, repertoireId),
							eq(userRepertoireMove.fromFen, fromFen)
						)
					);
			});

			const [updated] = await db.select().from(userMove).where(eq(userMove.id, existing.id));
			return json(updated);
		}
	} else {
		// Opponent's turn — multiple moves allowed, but no exact duplicates.
		const [existing] = await db
			.select()
			.from(userMove)
			.where(
				and(
					eq(userMove.repertoireId, repertoireId),
					eq(userMove.fromFen, fromFen),
					eq(userMove.san, san)
				)
			);

		if (existing) {
			return json(existing);
		}
	}

	// Insert the new move and (for user's own moves) its SR card in a single
	// transaction so both writes either succeed or roll back together.
	// Opponent moves are not drilled.
	const savedMove = await db.transaction(async (tx) => {
		const [move] = await tx
			.insert(userMove)
			.values({
				userId: user.id,
				repertoireId,
				fromFen,
				toFen,
				san,
				source: 'PERSONAL',
				notes: null,
				createdAt: new Date()
			})
			.returning();

		if (isUserTurn) {
			await tx.insert(userRepertoireMove).values({
				userId: user.id,
				repertoireId,
				fromFen,
				san,
				due: new Date(),
				state: 0, // New
				reps: 0,
				lapses: 0,
				stability: null,
				difficulty: null,
				elapsedDays: null,
				scheduledDays: null,
				lastReview: null,
				learningSteps: 0
			});
		}

		return move;
	});

	return json(savedMove, { status: 201 });
};
