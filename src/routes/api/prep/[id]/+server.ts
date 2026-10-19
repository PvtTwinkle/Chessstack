// GET    /api/prep/:id — load a single prep with all its data
// PATCH  /api/prep/:id — update filter settings (minGames, excludedMoves)
// DELETE /api/prep/:id — delete a prep (cascade removes all moves)

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { opponentPreps, opponentMoves, prepMoves } from '$lib/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { parseBody } from '$lib/server/validation';
import { updatePrepSchema } from '$lib/server/schemas/prep';
import { requireAuth, parseIntParam } from '$lib/server/api-helpers';

// ── GET ──────────────────────────────────────────────────────────────────────

export const GET: RequestHandler = async ({ locals, params }) => {
	const user = requireAuth(locals);

	const prepId = parseIntParam(params.id, 'prep ID');

	const [prep] = await db
		.select()
		.from(opponentPreps)
		.where(
			and(
				eq(opponentPreps.id, prepId),
				eq(opponentPreps.userId, user.id),
				isNull(opponentPreps.pendingSince)
			)
		);

	if (!prep) throw error(404, 'Prep not found');

	// Load opponent moves and prep moves in parallel
	const [oppMoves, userPrepMoves] = await Promise.all([
		db.select().from(opponentMoves).where(eq(opponentMoves.prepId, prepId)),
		db.select().from(prepMoves).where(eq(prepMoves.prepId, prepId))
	]);

	return json({ prep, opponentMoves: oppMoves, prepMoves: userPrepMoves });
};

// ── PATCH ────────────────────────────────────────────────────────────────────

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const user = requireAuth(locals);

	const prepId = parseIntParam(params.id, 'prep ID');

	const body = await parseBody(request, updatePrepSchema);

	// Verify ownership
	const [prep] = await db
		.select({ id: opponentPreps.id })
		.from(opponentPreps)
		.where(and(eq(opponentPreps.id, prepId), eq(opponentPreps.userId, user.id)));

	if (!prep) throw error(404, 'Prep not found');

	const updates: Partial<typeof opponentPreps.$inferInsert> = {};
	if (body.minGames !== undefined) updates.minGames = body.minGames;
	if (body.excludedMoves !== undefined) updates.excludedMoves = JSON.stringify(body.excludedMoves);

	await db.update(opponentPreps).set(updates).where(eq(opponentPreps.id, prepId));

	return json({ updated: true });
};

// ── DELETE ───────────────────────────────────────────────────────────────────

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const user = requireAuth(locals);

	const prepId = parseIntParam(params.id, 'prep ID');

	// Verify ownership before deleting
	const [prep] = await db
		.select({ id: opponentPreps.id })
		.from(opponentPreps)
		.where(and(eq(opponentPreps.id, prepId), eq(opponentPreps.userId, user.id)));

	if (!prep) throw error(404, 'Prep not found');

	// FK cascade deletes opponent_moves and prep_moves automatically
	await db.delete(opponentPreps).where(eq(opponentPreps.id, prepId));

	return json({ deleted: true });
};
