// GET    /api/prep/:id — load a single prep with all its data
// PATCH  /api/prep/:id — update filter settings (minGames, excludedMoves)
// DELETE /api/prep/:id — delete a prep (cascade removes all moves)

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { opponentPreps, opponentMoves, prepMoves } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { parseBody } from '$lib/server/validation';
import { updatePrepSchema } from '$lib/server/schemas/prep';

// ── GET ──────────────────────────────────────────────────────────────────────

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const prepId = parseInt(params.id);
	if (isNaN(prepId)) throw error(400, 'Invalid prep ID');

	const [prep] = await db
		.select()
		.from(opponentPreps)
		.where(and(eq(opponentPreps.id, prepId), eq(opponentPreps.userId, locals.user.id)));

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
	if (!locals.user) throw error(401, 'Not authenticated');

	const prepId = parseInt(params.id);
	if (isNaN(prepId)) throw error(400, 'Invalid prep ID');

	const body = await parseBody(request, updatePrepSchema);

	// Verify ownership
	const [prep] = await db
		.select({ id: opponentPreps.id })
		.from(opponentPreps)
		.where(and(eq(opponentPreps.id, prepId), eq(opponentPreps.userId, locals.user.id)));

	if (!prep) throw error(404, 'Prep not found');

	const updates: Partial<typeof opponentPreps.$inferInsert> = {};
	if (body.minGames !== undefined) updates.minGames = body.minGames;
	if (body.excludedMoves !== undefined) updates.excludedMoves = JSON.stringify(body.excludedMoves);

	await db.update(opponentPreps).set(updates).where(eq(opponentPreps.id, prepId));

	return json({ updated: true });
};

// ── DELETE ───────────────────────────────────────────────────────────────────

export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const prepId = parseInt(params.id);
	if (isNaN(prepId)) throw error(400, 'Invalid prep ID');

	// Verify ownership before deleting
	const [prep] = await db
		.select({ id: opponentPreps.id })
		.from(opponentPreps)
		.where(and(eq(opponentPreps.id, prepId), eq(opponentPreps.userId, locals.user.id)));

	if (!prep) throw error(404, 'Prep not found');

	// FK cascade deletes opponent_moves and prep_moves automatically
	await db.delete(opponentPreps).where(eq(opponentPreps.id, prepId));

	return json({ deleted: true });
};
