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
import { fenKey } from '$lib/fen';
import { parseBody } from '$lib/server/validation';
import { addPrepToRepertoireSchema } from '$lib/server/schemas/prep';

export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const prepId = parseInt(params.id);
	if (isNaN(prepId)) throw error(400, 'Invalid prep ID');

	const { mode, repertoireId, color, replacements } = await parseBody(
		request,
		addPrepToRepertoireSchema
	);

	const userId = locals.user.id;

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

	const repColor = rep.color as 'WHITE' | 'BLACK';

	// Load prep moves for this color
	const userPrepMoves = await db
		.select()
		.from(prepMoves)
		.where(and(eq(prepMoves.prepId, prepId), eq(prepMoves.color, color)));

	if (userPrepMoves.length === 0) {
		throw error(400, `No prep moves for ${color}.`);
	}

	// Load existing repertoire moves for conflict detection
	const existingMoves = await db
		.select({ fromFen: userMove.fromFen, san: userMove.san })
		.from(userMove)
		.where(and(eq(userMove.userId, userId), eq(userMove.repertoireId, repertoireId)));

	// Build lookup: fenKey → existing SAN
	const existingByFen = new Map<string, string>();
	for (const m of existingMoves) {
		const key = fenKey(m.fromFen);
		// For user-turn positions, only one move exists, so first one wins
		if (!existingByFen.has(key)) {
			existingByFen.set(key, m.san);
		}
	}

	// Also load opponent moves to include as connecting moves
	const oppMoves = await db.select().from(opponentMoves).where(eq(opponentMoves.prepId, prepId));

	// Validate all prep moves and detect conflicts
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

	const validatedMoves: ValidatedMove[] = [];
	const conflicts: Conflict[] = [];
	let duplicates = 0;

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

		if (isUserTurn) {
			const existing = existingByFen.get(from);
			if (existing) {
				if (existing === pm.san) {
					duplicates++;
					continue; // Already exists identically
				}
				// Conflict: different move at same position
				conflicts.push({ fromFen: from, existingMove: existing, prepMove: pm.san });
				continue;
			}
		} else {
			// Opponent turn — check for exact duplicate
			const isDup = existingMoves.some((m) => fenKey(m.fromFen) === from && m.san === pm.san);
			if (isDup) {
				duplicates++;
				continue;
			}
		}

		validatedMoves.push({ fromFen: from, toFen, san: pm.san, isUserTurn });
	}

	// Also prepare connecting opponent moves
	const connectingMoves: ValidatedMove[] = [];
	const prepFromFens = new Set(userPrepMoves.map((m) => fenKey(m.fromFen)));
	const expectedOppColor = repColor === 'WHITE' ? 'b' : 'w';

	for (const om of oppMoves) {
		const resultKey = fenKey(om.resultingFen);
		if (!prepFromFens.has(resultKey)) continue;

		if (om.opponentColor !== expectedOppColor) continue;
		const fenActiveSide = om.positionFen.split(' ')[1];
		if (om.opponentColor !== fenActiveSide) continue;

		const from = fenKey(om.positionFen);

		// Skip if already in repertoire
		const isDup = existingMoves.some((m) => fenKey(m.fromFen) === from && m.san === om.moveSan);
		if (isDup) continue;

		// Skip if already in validated moves
		const alreadyAdded = validatedMoves.some((m) => m.fromFen === from && m.san === om.moveSan);
		if (alreadyAdded) continue;

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

	if (mode === 'preview') {
		return json({
			newMoves: validatedMoves.length,
			connectingMoves: connectingMoves.length,
			duplicates,
			conflicts
		});
	}

	// Execute mode — insert moves with conflict resolutions
	const replacementSet = new Set(replacements.map((r) => fenKey(r.fromFen) + '|' + r.san));

	const now = new Date();
	let inserted = 0;
	let replaced = 0;
	let skipped = 0;

	await db.transaction(async (tx) => {
		// Insert new prep moves
		for (const vm of validatedMoves) {
			await tx.insert(userMove).values({
				userId,
				repertoireId,
				fromFen: vm.fromFen,
				toFen: vm.toFen,
				san: vm.san,
				source: 'PREP_EXPORT',
				notes: null,
				createdAt: now
			});

			if (vm.isUserTurn) {
				await tx.insert(userRepertoireMove).values({
					userId,
					repertoireId,
					fromFen: vm.fromFen,
					san: vm.san,
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
				});
			}
			inserted++;
		}

		// Handle conflicts — apply user's chosen replacements
		for (const conflict of conflicts) {
			const key = fenKey(conflict.fromFen) + '|' + conflict.prepMove;
			if (replacementSet.has(key)) {
				// User chose the prep move — delete existing move's subtree and replace
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

				if (existingRow) {
					// Delete old SR card
					await tx
						.delete(userRepertoireMove)
						.where(
							and(
								eq(userRepertoireMove.userId, userId),
								eq(userRepertoireMove.repertoireId, repertoireId),
								eq(userRepertoireMove.fromFen, conflict.fromFen),
								eq(userRepertoireMove.san, conflict.existingMove)
							)
						);
					// Update the move in place
					await tx
						.update(userMove)
						.set({
							san: conflict.prepMove,
							toFen: (() => {
								try {
									const chess = new Chess(conflict.fromFen);
									const r = chess.move(conflict.prepMove);
									return r ? fenKey(chess.fen()) : existingRow.toFen;
								} catch {
									return existingRow.toFen;
								}
							})(),
							source: 'PREP_EXPORT',
							createdAt: now
						})
						.where(eq(userMove.id, existingRow.id));
					// Create new SR card
					await tx.insert(userRepertoireMove).values({
						userId,
						repertoireId,
						fromFen: conflict.fromFen,
						san: conflict.prepMove,
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
					});
					replaced++;
				}
			} else {
				skipped++; // Keep existing move
			}
		}

		// Insert connecting opponent moves
		for (const cm of connectingMoves) {
			await tx.insert(userMove).values({
				userId,
				repertoireId,
				fromFen: cm.fromFen,
				toFen: cm.toFen,
				san: cm.san,
				source: 'PREP_EXPORT',
				notes: null,
				createdAt: now
			});
		}
	});

	return json({ inserted, replaced, skipped, connecting: connectingMoves.length });
};
