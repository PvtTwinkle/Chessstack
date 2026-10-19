// DELETE /api/moves/[id] — remove a move and its entire downstream subtree.
//
// Opening repertoires are trees. If you delete a move mid-tree, you leave
// orphaned branches behind (positions with no reachable path from the start).
// To keep the tree clean, this endpoint deletes the target move AND every move
// that can no longer be reached from the start without it. A position that
// another line transposes into keeps its moves.
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
import { userMove } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { isRepertoireLocked } from '$lib/stripe/tiers.server';
import { requireAuth, parseIntParam } from '$lib/server/api-helpers';
import { parseBody } from '$lib/server/validation';
import { updateMoveNotesSchema } from '$lib/server/schemas/moves';
import { deleteMove, lockRepertoire } from '$lib/server/repertoire-moves';

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

	const deleted = await db.transaction(async (tx) => {
		await lockRepertoire(tx, move.repertoireId);
		// A delete that ran while this one waited for the lock may have taken it.
		const [current] = await tx.select().from(userMove).where(eq(userMove.id, id));
		return current ? deleteMove(tx, user.id, current) : 0;
	});

	if (deleted === 0) throw error(404, 'Move not found');

	return json({ deleted });
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
