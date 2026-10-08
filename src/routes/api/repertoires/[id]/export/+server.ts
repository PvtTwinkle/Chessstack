// GET /api/repertoires/[id]/export — export a repertoire as PGN

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { repertoire, userMove } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { exportRepertoirePgn } from '$lib/pgn/exportPgn';
import { requireAuth, parseIntParam } from '$lib/server/api-helpers';

export const GET: RequestHandler = async ({ locals, params }) => {
	const user = requireAuth(locals);

	const id = parseIntParam(params.id, 'id');

	// Ownership check
	const [existing] = await db
		.select()
		.from(repertoire)
		.where(and(eq(repertoire.id, id), eq(repertoire.userId, user.id)));

	if (!existing) throw error(404, 'Repertoire not found');

	// Fetch all moves for this repertoire
	const moves = await db
		.select()
		.from(userMove)
		.where(and(eq(userMove.repertoireId, id), eq(userMove.userId, user.id)));

	const pgn = exportRepertoirePgn({
		repertoireName: existing.name,
		repertoireColor: existing.color as 'WHITE' | 'BLACK',
		moves: moves.map((m) => ({
			fromFen: m.fromFen,
			toFen: m.toFen,
			san: m.san,
			notes: m.notes,
			// createdAt is a Date object (Drizzle timestamp mode) — convert to ms
			createdAt: m.createdAt.getTime()
		}))
	});

	// Sanitize the name for use as a filename
	const safeName = existing.name.replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'repertoire';
	const filename = `${safeName}.pgn`;

	return json({ pgn, filename });
};
