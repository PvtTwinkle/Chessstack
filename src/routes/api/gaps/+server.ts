// GET /api/gaps?repertoireId=X — find uncovered positions in a repertoire.
//
// Returns all "gaps" — opponent book moves that the user has no prepared
// response to. Each gap includes a deep-link line for Build Mode.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { repertoire, userMove, userSettings } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { loadGapData } from '$lib/gaps';
import { isRateLimited } from '$lib/auth/rate-limit';
import { RATE_LIMITS } from '$lib/auth/rate-limit-config';
import { requireAuth, parseIntParam } from '$lib/server/api-helpers';

export const GET: RequestHandler = async ({ locals, url }) => {
	const user = requireAuth(locals);

	if (await isRateLimited(String(user.id), RATE_LIMITS.gaps)) {
		return json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
	}

	const repertoireIdParam = url.searchParams.get('repertoireId');
	if (!repertoireIdParam) throw error(400, 'repertoireId query parameter is required');

	const repertoireId = parseIntParam(repertoireIdParam, 'repertoireId');

	// Verify the repertoire exists and belongs to this user.
	const [rep] = await db
		.select()
		.from(repertoire)
		.where(and(eq(repertoire.id, repertoireId), eq(repertoire.userId, user.id)));

	if (!rep) throw error(404, 'Repertoire not found');

	// Load all user moves for this repertoire.
	const moves = await db
		.select()
		.from(userMove)
		.where(and(eq(userMove.repertoireId, repertoireId), eq(userMove.userId, user.id)));

	// Read the user's gap threshold setting (default 1000).
	const [userSettingsRow] = await db
		.select({ gapMinGames: userSettings.gapMinGames })
		.from(userSettings)
		.where(eq(userSettings.userId, user.id));

	const gaps = await loadGapData(
		db,
		moves,
		rep.color as 'WHITE' | 'BLACK',
		rep.startFen ?? null,
		userSettingsRow?.gapMinGames ?? 10000
	);

	return json({ count: gaps.length, gaps });
};
