// DELETE /api/moves/[id] — remove a move and its entire downstream subtree.
//
// Opening repertoires are trees. If you delete a move mid-tree, you leave
// orphaned branches behind (positions with no reachable path from the start).
// To keep the tree clean, this endpoint deletes the target move AND every move
// that is only reachable through it.
//
// Example tree:
//   Start → e4 → e5 → Nf3 → Nc6
//                    → d4         ← a second branch
//
// Deleting "e5" deletes the entire subtree: Nf3, Nc6, and d4.
// Deleting "Nf3" only deletes Nf3 and Nc6 — the "e4 → e5 → d4" branch survives.
//
// This also cleans up the corresponding user_repertoire_move (SR card) rows,
// so deleted moves do not keep appearing in drill sessions.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { userMove, userRepertoireMove } from '$lib/db/schema';
import { eq, and, notExists, sql, inArray } from 'drizzle-orm';
import { isRepertoireLocked } from '$lib/stripe/tiers.server';
import { requireAuth, parseIntParam } from '$lib/server/api-helpers';
import { parseBody } from '$lib/server/validation';
import { updateMoveNotesSchema } from '$lib/server/schemas/moves';

// Collects all move IDs in the subtree reachable from startFen using a
// recursive CTE, then batch-deletes SR cards and moves in just 3 queries.
// This replaces the old recursive function that did 3 queries per move.
async function deleteSubtree(
	userId: number,
	repertoireId: number,
	startFen: string
): Promise<number> {
	// Step 1: Collect all moves in the subtree with a recursive CTE.
	// Walks from_fen → to_fen links within the same repertoire.
	const subtreeRows = await db.execute<{ id: number; from_fen: string; san: string }>(sql`
		WITH RECURSIVE subtree AS (
			SELECT id, from_fen, to_fen, san
			FROM user_move
			WHERE repertoire_id = ${repertoireId} AND from_fen = ${startFen}
			UNION ALL
			SELECT m.id, m.from_fen, m.to_fen, m.san
			FROM user_move m
			JOIN subtree s ON m.from_fen = s.to_fen
			WHERE m.repertoire_id = ${repertoireId}
		)
		SELECT id, from_fen, san FROM subtree
	`);

	if (subtreeRows.length === 0) return 0;

	const moveIds = subtreeRows.map((r) => r.id);

	// Step 2: Batch delete SR cards matching any (fromFen, san) in the subtree.
	// Uses a VALUES list to match the composite key pairs.
	await db.execute(sql`
		DELETE FROM user_repertoire_move
		WHERE user_id = ${userId}
		  AND repertoire_id = ${repertoireId}
		  AND (from_fen, san) IN (${sql.join(
				subtreeRows.map((r) => sql`(${r.from_fen}, ${r.san})`),
				sql`, `
			)})
	`);

	// Step 3: Batch delete all move rows by ID.
	await db.delete(userMove).where(inArray(userMove.id, moveIds));

	return moveIds.length;
}

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const user = requireAuth(locals);

	const id = parseIntParam(params.id, 'move ID');

	// Fetch the move — must exist and belong to this user.
	const [move] = await db
		.select()
		.from(userMove)
		.where(and(eq(userMove.id, id), eq(userMove.userId, user.id)));

	if (!move) throw error(404, 'Move not found');

	if (await isRepertoireLocked(user.id, move.repertoireId, user.tier ?? 'free')) {
		throw error(403, 'This repertoire is read-only. Upgrade your plan to edit it.');
	}

	// Delete all moves reachable from this move's destination position.
	const subtreeCount = await deleteSubtree(user.id, move.repertoireId, move.toFen);

	// Delete the SR card for the move being deleted.
	await db
		.delete(userRepertoireMove)
		.where(
			and(
				eq(userRepertoireMove.userId, user.id),
				eq(userRepertoireMove.repertoireId, move.repertoireId),
				eq(userRepertoireMove.fromFen, move.fromFen),
				eq(userRepertoireMove.san, move.san)
			)
		);

	// Delete the move itself.
	await db.delete(userMove).where(eq(userMove.id, id));

	// Defense-in-depth: sweep for orphaned SR cards in this repertoire.
	// An SR card is orphaned if no userMove exists with the same
	// (repertoireId, fromFen, san). This catches edge cases like FEN
	// normalization mismatches from PGN transpositions.
	// Single DELETE with NOT EXISTS — no per-card roundtrips.
	await db.delete(userRepertoireMove).where(
		and(
			eq(userRepertoireMove.userId, user.id),
			eq(userRepertoireMove.repertoireId, move.repertoireId),
			notExists(
				db
					.select({ one: sql`1` })
					.from(userMove)
					.where(
						and(
							eq(userMove.repertoireId, userRepertoireMove.repertoireId),
							eq(userMove.fromFen, userRepertoireMove.fromFen),
							eq(userMove.san, userRepertoireMove.san)
						)
					)
			)
		)
	);

	return json({ deleted: subtreeCount + 1 });
};

// ── PATCH ──────────────────────────────────────────────────────────────────────
// Updates the notes annotation on a single move.
// Expects JSON body: { notes: string | null }
// An empty string is coerced to null — we do not store empty annotations.

export const PATCH: RequestHandler = async ({ locals, request, params }) => {
	const user = requireAuth(locals);

	const id = parseIntParam(params.id, 'move ID');

	// Ownership check — one query, fails for wrong user or missing row.
	const [move] = await db
		.select()
		.from(userMove)
		.where(and(eq(userMove.id, id), eq(userMove.userId, user.id)));

	if (!move) throw error(404, 'Move not found');

	if (await isRepertoireLocked(user.id, move.repertoireId, user.tier ?? 'free')) {
		throw error(403, 'This repertoire is read-only. Upgrade your plan to edit it.');
	}

	const { notes } = await parseBody(request, updateMoveNotesSchema);

	const [updated] = await db
		.update(userMove)
		.set({ notes })
		.where(and(eq(userMove.id, id), eq(userMove.userId, user.id)))
		.returning();

	return json(updated);
};
