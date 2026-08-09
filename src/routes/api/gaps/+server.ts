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
import { gapRatingWindow } from '$lib/ratings';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const repertoireIdParam = url.searchParams.get('repertoireId');
	if (!repertoireIdParam) throw error(400, 'repertoireId query parameter is required');

	const repertoireId = parseInt(repertoireIdParam);
	if (isNaN(repertoireId)) throw error(400, 'repertoireId must be a number');

	// Verify the repertoire exists and belongs to this user.
	const [rep] = await db
		.select()
		.from(repertoire)
		.where(and(eq(repertoire.id, repertoireId), eq(repertoire.userId, locals.user.id)));

	if (!rep) throw error(404, 'Repertoire not found');

	// Load all user moves for this repertoire.
	const moves = await db
		.select()
		.from(userMove)
		.where(and(eq(userMove.repertoireId, repertoireId), eq(userMove.userId, locals.user.id)));

	// Read the user's gap threshold settings and trainer rating (used to pick
	// the Lichess rating-bracket window).
	const [userSettingsRow] = await db
		.select({
			gapMinGames: userSettings.gapMinGames,
			gapMinPopularityPct: userSettings.gapMinPopularityPct,
			trainerRating: userSettings.trainerRating
		})
		.from(userSettings)
		.where(eq(userSettings.userId, locals.user.id));

	const gaps = await loadGapData(
		db,
		moves,
		rep.color as 'WHITE' | 'BLACK',
		rep.startFen ?? null,
		userSettingsRow?.gapMinGames ?? 10000,
		userSettingsRow?.gapMinPopularityPct ?? 5,
		userSettingsRow?.trainerRating ?? null
	);

	const { label: gapRatingLabel } = gapRatingWindow(userSettingsRow?.trainerRating ?? null);

	return json({ count: gaps.length, gaps, gapRatingLabel });
};
