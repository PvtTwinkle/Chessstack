// POST /api/prep/:id/export — export prep moves as a new repertoire.
//
// Creates a new repertoire and copies all prep moves (+ connecting opponent moves)
// into it, with FSRS cards for the user's own moves so they can be drilled.
//
// Body: { color: 'white' | 'black' }
// Returns: { repertoireId: number, name: string }

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
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
import { fenKey, STARTING_FEN } from '$lib/fen';
import { parseBody } from '$lib/server/validation';
import { exportPrepSchema } from '$lib/server/schemas/prep';
import { requireAuth, parseIntParam } from '$lib/server/api-helpers';
import { isUserTurn, newCard, playMove } from '$lib/server/repertoire-moves';
import { walkableEdges } from '$lib/server/prep-connect';
import { connectingEdges, type Edge } from '$lib/prep/connect';
import { repertoireLimitMessage } from '$lib/stripe/tiers.server';

export const POST: RequestHandler = async ({ locals, params, request }) => {
	const user = requireAuth(locals);

	const prepId = parseIntParam(params.id, 'prep ID');

	const { color } = await parseBody(request, exportPrepSchema);

	// Verify prep ownership
	const [prep] = await db
		.select()
		.from(opponentPreps)
		.where(and(eq(opponentPreps.id, prepId), eq(opponentPreps.userId, user.id)));

	if (!prep) throw error(404, 'Prep not found');

	const userId = user.id;
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

	// Exporting creates a repertoire, so the plan's limit applies as it does
	// to the repertoire form.
	const overLimit = await repertoireLimitMessage(userId, user.tier ?? 'free');
	if (overLimit) throw error(403, overLimit);

	// Load opponent moves for this prep — we need them to build connecting moves
	const oppMoves = await db.select().from(opponentMoves).where(eq(opponentMoves.prepId, prepId));

	// Build a set of FENs reachable through prep moves so we know which
	// opponent moves are needed to connect the tree
	const prepFromFens = new Set(userPrepMoves.map((m) => fenKey(m.fromFen)));
	const prepToFens = new Set(userPrepMoves.map((m) => fenKey(m.toFen)));
	const userTurn = (fen: string) => isUserTurn(repColor, fen);

	const moveRows: Edge[] = [];
	// The new repertoire saves each move once, and one move per position on
	// the user's turn (its unique indexes would reject anything else).
	const savedKeys = new Set<string>();
	const cardFens = new Set<string>();
	const saveMove = (m: Edge): void => {
		const from = fenKey(m.fromFen);
		if (savedKeys.has(`${from}|${m.san}`)) return;
		if (userTurn(from)) {
			if (cardFens.has(from)) return;
			cardFens.add(from);
		}
		savedKeys.add(`${from}|${m.san}`);
		moveRows.push({ fromFen: from, toFen: fenKey(m.toFen), san: m.san });
	};

	for (const pm of userPrepMoves) saveMove(pm);

	// Add connecting opponent moves — only include moves where the opponent
	// was playing the opposite color from the export color.
	const expectedOppColor = repColor === 'WHITE' ? 'b' : 'w';
	for (const om of oppMoves) {
		const resultKey = fenKey(om.resultingFen);
		if (!prepFromFens.has(resultKey) && !prepToFens.has(resultKey)) continue;

		// Only include moves from games where the opponent played the expected color
		if (om.opponentColor !== expectedOppColor) continue;
		const fenActiveSide = om.positionFen.split(' ')[1];
		if (om.opponentColor !== fenActiveSide) continue;

		const played = playMove(om.positionFen, om.moveSan);
		if (played) saveMove(played);
	}

	// Link prep moves that were played after stepping through a repertoire or
	// game move, so no line in the new repertoire starts in mid-air.
	const linking = connectingEdges(
		STARTING_FEN,
		[...moveRows],
		[],
		await walkableEdges(userId, repColor, oppMoves),
		userTurn
	);
	for (const m of linking) saveMove(m);

	const now = new Date();

	const result = await db.transaction(async (tx) => {
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

		// Drill cards for the user's own moves; the opponent's aren't drilled.
		const cardRows = moveRows
			.filter((m) => userTurn(m.fromFen))
			.map((m) => newCard(userId, repertoireId, m.fromFen, m.san));
		if (cardRows.length > 0) await tx.insert(userRepertoireMove).values(cardRows);

		return { repertoireId, name: repName };
	});

	return json(result, { status: 201 });
};
