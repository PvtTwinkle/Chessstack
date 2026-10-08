// POST /api/prep/:id/export — export prep moves as a new repertoire.
//
// Creates a new repertoire and copies all prep moves (+ connecting opponent moves)
// into it, with FSRS cards for the user's own moves so they can be drilled.
//
// Body: { color: 'white' | 'black' }
// Returns: { repertoireId: number, name: string }

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { Chess } from 'chess.js';
import { db } from '$lib/db';
import {
	opponentPreps,
	opponentMoves,
	prepMoves,
	repertoire,
	userMove,
	userRepertoireMove
} from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { fenKey } from '$lib/fen';
import { parseBody } from '$lib/server/validation';
import { exportPrepSchema } from '$lib/server/schemas/prep';

export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const prepId = parseInt(params.id);
	if (isNaN(prepId)) throw error(400, 'Invalid prep ID');

	const { color } = await parseBody(request, exportPrepSchema);

	// Verify prep ownership
	const [prep] = await db
		.select()
		.from(opponentPreps)
		.where(and(eq(opponentPreps.id, prepId), eq(opponentPreps.userId, locals.user.id)));

	if (!prep) throw error(404, 'Prep not found');

	const userId = locals.user.id;
	const repColor = color === 'white' ? 'WHITE' : 'BLACK';
	const repName = `Prep vs ${prep.opponentName} — ${color === 'white' ? 'White' : 'Black'}`;

	// Load prep moves for this color
	const userPrepMoves = await db
		.select()
		.from(prepMoves)
		.where(and(eq(prepMoves.prepId, prepId), eq(prepMoves.color, color)));

	if (userPrepMoves.length === 0) {
		throw error(400, `No prep moves for ${color}. Build some prep moves first.`);
	}

	// Load opponent moves for this prep — we need them to build connecting moves
	const oppMoves = await db.select().from(opponentMoves).where(eq(opponentMoves.prepId, prepId));

	// Build a set of FENs reachable through prep moves so we know which
	// opponent moves are needed to connect the tree
	const prepFromFens = new Set(userPrepMoves.map((m) => fenKey(m.fromFen)));
	const prepToFens = new Set(userPrepMoves.map((m) => fenKey(m.toFen)));

	const now = new Date();

	const result = await db.transaction(async (tx) => {
		// Create the repertoire
		const [rep] = await tx
			.insert(repertoire)
			.values({
				userId,
				name: repName,
				color: repColor,
				createdAt: now
			})
			.returning();

		const repertoireId = rep.id;

		// Prepare all moves for batch insert
		const moveRows: { fromFen: string; toFen: string; san: string }[] = [];
		const fsrsRows: { fromFen: string; san: string }[] = [];

		for (const pm of userPrepMoves) {
			const from = fenKey(pm.fromFen);
			const to = fenKey(pm.toFen);
			moveRows.push({ fromFen: from, toFen: to, san: pm.san });

			try {
				const chess = new Chess(from);
				const fenTurn = chess.turn();
				const isUserTurnAtPosition =
					(repColor === 'WHITE' && fenTurn === 'w') || (repColor === 'BLACK' && fenTurn === 'b');
				if (isUserTurnAtPosition) fsrsRows.push({ fromFen: from, san: pm.san });
			} catch {
				// skip FSRS card if FEN is invalid
			}
		}

		// Add connecting opponent moves — only include moves where the opponent
		// was playing the opposite color from the export color.
		const expectedOppColor = repColor === 'WHITE' ? 'b' : 'w';
		const prepFenSanSet = new Set(userPrepMoves.map((pm) => `${fenKey(pm.fromFen)}|${pm.san}`));
		for (const om of oppMoves) {
			const resultKey = fenKey(om.resultingFen);
			if (!prepFromFens.has(resultKey) && !prepToFens.has(resultKey)) continue;

			// Only include moves from games where the opponent played the expected color
			if (om.opponentColor !== expectedOppColor) continue;
			const fenActiveSide = om.positionFen.split(' ')[1];
			if (om.opponentColor !== fenActiveSide) continue;

			const from = fenKey(om.positionFen);
			if (prepFenSanSet.has(`${from}|${om.moveSan}`)) continue;

			try {
				const chess = new Chess(from);
				const result = chess.move(om.moveSan);
				if (!result) continue;
				moveRows.push({ fromFen: from, toFen: fenKey(chess.fen()), san: om.moveSan });
			} catch {
				continue;
			}
		}

		// Batch insert all moves
		if (moveRows.length > 0) {
			await tx.insert(userMove).values(
				moveRows.map((m) => ({
					userId,
					repertoireId,
					fromFen: m.fromFen,
					toFen: m.toFen,
					san: m.san,
					source: 'PREP_EXPORT',
					notes: null,
					createdAt: now
				}))
			);
		}

		// Batch insert FSRS cards
		if (fsrsRows.length > 0) {
			await tx.insert(userRepertoireMove).values(
				fsrsRows.map((m) => ({
					userId,
					repertoireId,
					fromFen: m.fromFen,
					san: m.san,
					due: now,
					state: 0,
					reps: 0,
					lapses: 0,
					stability: null,
					difficulty: null,
					elapsedDays: null,
					scheduledDays: null,
					lastReview: null,
					learningSteps: 0
				}))
			);
			// No FSRS card — this is the opponent's move, not drillable
		}

		return { repertoireId, name: repName };
	});

	return json(result, { status: 201 });
};
