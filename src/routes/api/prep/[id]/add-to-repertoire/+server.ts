// POST /api/prep/:id/add-to-repertoire — add prep moves into an existing repertoire.
//
// Two modes:
//   mode: 'preview' — detect conflicts without inserting anything
//   mode: 'execute' — insert moves, using provided conflict resolutions
//
// This mirrors the PGN import flow (parse → preview → resolve → execute)
// but sources moves from prep_moves instead of a PGN string.

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
import { fenKey, STARTING_FEN } from '$lib/fen';
import { connectingEdges, type Edge } from '$lib/prep/connect';
import { walkableEdges } from '$lib/server/prep-connect';
import { parseBody } from '$lib/server/validation';
import { addPrepToRepertoireSchema } from '$lib/server/schemas/prep';
import { isRepertoireLocked } from '$lib/stripe/tiers.server';
import {
	isUserTurn,
	lockRepertoire,
	newCard,
	playMove,
	replaceMove,
	type Transaction
} from '$lib/server/repertoire-moves';
import { requireAuth, parseIntParam } from '$lib/server/api-helpers';

type PrepMoveRow = typeof prepMoves.$inferSelect;
type OpponentMoveRow = typeof opponentMoves.$inferSelect;

interface ValidatedMove {
	fromFen: string;
	toFen: string;
	san: string;
	isUserTurn: boolean;
}

interface Conflict {
	fromFen: string;
	existingMove: string;
	prepMove: string;
}

interface Plan {
	validatedMoves: ValidatedMove[];
	connectingMoves: ValidatedMove[];
	conflicts: Conflict[];
	duplicates: number;
}

/**
 * Sorts the prep moves into new moves, duplicates and conflicts against the
 * repertoire's existing moves, and finds the opponent moves that connect the
 * prep lines to each other.
 */
function planMoves(
	userPrepMoves: PrepMoveRow[],
	oppMoves: OpponentMoveRow[],
	existingMoves: Edge[],
	repColor: 'WHITE' | 'BLACK',
	walkable: Edge[]
): Plan {
	// fenKey → existing SAN. On the user's turn a position has one move, so the
	// first one wins.
	const existingByFen = new Map<string, string>();
	const existingKeys = new Set<string>();
	for (const m of existingMoves) {
		const key = fenKey(m.fromFen);
		if (!existingByFen.has(key)) existingByFen.set(key, m.san);
		existingKeys.add(`${key}|${m.san}`);
	}

	const validatedMoves: ValidatedMove[] = [];
	const conflicts: Conflict[] = [];
	let duplicates = 0;
	// The prep itself can't save a move twice, or two of the user's moves at one position.
	const plannedKeys = new Set<string>();
	const plannedUserFens = new Set<string>();

	for (const pm of userPrepMoves) {
		const from = fenKey(pm.fromFen);
		let toFen: string;
		let isUserTurn: boolean;

		try {
			const chess = new Chess(from);
			const fenTurn = chess.turn();
			isUserTurn =
				(repColor === 'WHITE' && fenTurn === 'w') || (repColor === 'BLACK' && fenTurn === 'b');
			const result = chess.move(pm.san);
			if (!result) continue;
			toFen = fenKey(chess.fen());
		} catch {
			continue;
		}

		if (existingKeys.has(`${from}|${pm.san}`)) {
			duplicates++;
			continue;
		}
		if (isUserTurn) {
			const existing = existingByFen.get(from);
			if (existing) {
				conflicts.push({ fromFen: from, existingMove: existing, prepMove: pm.san });
				continue;
			}
		}

		if (plannedKeys.has(`${from}|${pm.san}`)) continue;
		if (isUserTurn && plannedUserFens.has(from)) continue;
		plannedKeys.add(`${from}|${pm.san}`);
		if (isUserTurn) plannedUserFens.add(from);

		validatedMoves.push({ fromFen: from, toFen, san: pm.san, isUserTurn });
	}

	const connectingMoves: ValidatedMove[] = [];
	const prepFromFens = new Set(userPrepMoves.map((m) => fenKey(m.fromFen)));
	const validatedKeys = new Set(validatedMoves.map((m) => `${m.fromFen}|${m.san}`));
	const expectedOppColor = repColor === 'WHITE' ? 'b' : 'w';

	for (const om of oppMoves) {
		if (!prepFromFens.has(fenKey(om.resultingFen))) continue;
		if (om.opponentColor !== expectedOppColor) continue;
		if (om.opponentColor !== om.positionFen.split(' ')[1]) continue;

		const from = fenKey(om.positionFen);
		const key = `${from}|${om.moveSan}`;
		if (existingKeys.has(key) || validatedKeys.has(key)) continue;

		try {
			const chess = new Chess(from);
			const result = chess.move(om.moveSan);
			if (!result) continue;
			connectingMoves.push({
				fromFen: from,
				toFen: fenKey(chess.fen()),
				san: om.moveSan,
				isUserTurn: false
			});
		} catch {
			continue;
		}
	}

	// Prep moves played after stepping through a game or repertoire move have
	// no saved move leading to them; add the steps so they can be reached.
	const linking = connectingEdges(
		STARTING_FEN,
		[...validatedMoves, ...connectingMoves],
		existingMoves,
		walkable,
		(fen) => isUserTurn(repColor, fen)
	);
	for (const m of linking) {
		const played = playMove(m.fromFen, m.san);
		if (!played) continue;
		connectingMoves.push({ ...played, isUserTurn: isUserTurn(repColor, played.fromFen) });
	}

	return { validatedMoves, connectingMoves, conflicts, duplicates };
}

function loadExistingMoves(tx: Transaction | typeof db, userId: number, repertoireId: number) {
	return tx
		.select({ fromFen: userMove.fromFen, toFen: userMove.toFen, san: userMove.san })
		.from(userMove)
		.where(and(eq(userMove.userId, userId), eq(userMove.repertoireId, repertoireId)));
}

export const POST: RequestHandler = async ({ locals, params, request }) => {
	const user = requireAuth(locals);

	const prepId = parseIntParam(params.id, 'prep ID');

	const { mode, repertoireId, color, replacements } = await parseBody(
		request,
		addPrepToRepertoireSchema
	);

	const userId = user.id;

	// Verify prep ownership
	const [prep] = await db
		.select()
		.from(opponentPreps)
		.where(and(eq(opponentPreps.id, prepId), eq(opponentPreps.userId, userId)));
	if (!prep) throw error(404, 'Prep not found');

	// Verify repertoire ownership
	const [rep] = await db
		.select()
		.from(repertoire)
		.where(and(eq(repertoire.id, repertoireId), eq(repertoire.userId, userId)));
	if (!rep) throw error(404, 'Repertoire not found');

	if (await isRepertoireLocked(userId, repertoireId, user.tier ?? 'free')) {
		throw error(403, 'This repertoire is read-only. Upgrade your plan to edit it.');
	}

	const repColor = rep.color as 'WHITE' | 'BLACK';
	// The prep's moves are one side's; added to the other side's repertoire
	// they would be saved as the wrong player's moves.
	if (repColor !== (color === 'white' ? 'WHITE' : 'BLACK')) {
		throw error(400, `This repertoire is for ${repColor === 'WHITE' ? 'White' : 'Black'}.`);
	}

	// Load prep moves for this color
	const userPrepMoves = await db
		.select()
		.from(prepMoves)
		.where(and(eq(prepMoves.prepId, prepId), eq(prepMoves.color, color)));

	if (userPrepMoves.length === 0) {
		throw error(400, `No prep moves for ${color}.`);
	}

	// Opponent moves are included where they connect prep lines.
	const oppMoves = await db.select().from(opponentMoves).where(eq(opponentMoves.prepId, prepId));
	const walkable = await walkableEdges(userId, repColor, oppMoves);

	if (mode === 'preview') {
		const plan = planMoves(
			userPrepMoves,
			oppMoves,
			await loadExistingMoves(db, userId, repertoireId),
			repColor,
			walkable
		);
		return json({
			newMoves: plan.validatedMoves.length,
			connectingMoves: plan.connectingMoves.length,
			duplicates: plan.duplicates,
			conflicts: plan.conflicts
		});
	}

	const replacementSet = new Set(replacements.map((r) => fenKey(r.fromFen) + '|' + r.san));
	const now = new Date();

	const target = { userId, repertoireId, color: repColor };

	const result = await db.transaction(async (tx) => {
		await lockRepertoire(tx, repertoireId);

		// Replace first, then plan the inserts against what is left: removing the
		// old line can remove moves the prep would otherwise have counted as
		// duplicates or conflicts.
		const before = planMoves(
			userPrepMoves,
			oppMoves,
			await loadExistingMoves(tx, userId, repertoireId),
			repColor,
			walkable
		);

		let replaced = 0;
		for (const conflict of before.conflicts) {
			if (!replacementSet.has(conflict.fromFen + '|' + conflict.prepMove)) continue;

			const [existingRow] = await tx
				.select()
				.from(userMove)
				.where(
					and(
						eq(userMove.repertoireId, repertoireId),
						eq(userMove.fromFen, conflict.fromFen),
						eq(userMove.san, conflict.existingMove)
					)
				);
			// An earlier replacement may already have removed it with its line.
			if (!existingRow) continue;

			const played = playMove(conflict.fromFen, conflict.prepMove);
			if (!played) continue;

			await replaceMove(tx, target, existingRow, { ...played, source: 'PREP_EXPORT' });
			replaced++;
		}

		const plan = planMoves(
			userPrepMoves,
			oppMoves,
			await loadExistingMoves(tx, userId, repertoireId),
			repColor,
			walkable
		);

		const moveRows = [...plan.validatedMoves, ...plan.connectingMoves].map((m) => ({
			userId,
			repertoireId,
			fromFen: m.fromFen,
			toFen: m.toFen,
			san: m.san,
			source: 'PREP_EXPORT',
			notes: null,
			createdAt: now
		}));
		if (moveRows.length > 0) await tx.insert(userMove).values(moveRows);

		const cardRows = [...plan.validatedMoves, ...plan.connectingMoves]
			.filter((m) => m.isUserTurn)
			.map((m) => newCard(userId, repertoireId, m.fromFen, m.san));
		if (cardRows.length > 0) await tx.insert(userRepertoireMove).values(cardRows);

		return {
			inserted: plan.validatedMoves.length,
			replaced,
			skipped: plan.conflicts.length,
			connecting: plan.connectingMoves.length
		};
	});

	return json(result);
};
