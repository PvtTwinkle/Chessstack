// GET/POST/DELETE /api/train/saved-positions
//
// CRUD for saved starting positions used in opening trainer mode.
// Each user can save named positions for quick reuse.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { trainerSavedPosition } from '$lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { fenKey } from '$lib/fen';
import { parseBody } from '$lib/server/validation';
import { savePositionSchema, deletePositionSchema } from '$lib/server/schemas/train';

/** List all saved positions for the authenticated user. */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const positions = await db
		.select()
		.from(trainerSavedPosition)
		.where(eq(trainerSavedPosition.userId, locals.user.id))
		.orderBy(desc(trainerSavedPosition.createdAt));

	return json({ positions });
};

/** Save a new starting position. */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const body = await parseBody(request, savePositionSchema);
	const { name } = body;

	// Lead-in moves are stored as a JSON array of SAN strings.
	const leadInMoves = body.leadInMoves ? JSON.stringify(body.leadInMoves) : null;

	const normalizedFen = fenKey(body.fen);

	try {
		const [inserted] = await db
			.insert(trainerSavedPosition)
			.values({
				userId: locals.user.id,
				fen: normalizedFen,
				name,
				leadInMoves,
				createdAt: new Date()
			})
			.returning();

		return json({ position: inserted });
	} catch (err: unknown) {
		// Unique constraint violation (PG error 23505): user already saved this FEN
		if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
			throw error(409, 'This position is already saved');
		}
		throw err;
	}
};

/** Delete a saved position by ID. */
export const DELETE: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const body = await parseBody(request, deletePositionSchema);

	const deleted = await db
		.delete(trainerSavedPosition)
		.where(
			and(eq(trainerSavedPosition.id, body.id), eq(trainerSavedPosition.userId, locals.user.id))
		)
		.returning();

	if (deleted.length === 0) throw error(404, 'Position not found');

	return json({ deleted: true });
};
