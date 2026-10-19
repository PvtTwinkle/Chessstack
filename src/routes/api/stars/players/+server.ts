// GET /api/stars/players
//
// Returns the list of available celebrity players for the Stars tab dropdown.
// Queries the local star_players table — tiny result set (~20-30 rows max).

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { starPlayers } from '$lib/db/schema';
import { asc } from 'drizzle-orm';
import { requireAuth } from '$lib/server/api-helpers';
import type { StarPlayer } from '$lib/api-types';

export const GET: RequestHandler = async ({ locals }) => {
	requireAuth(locals);

	const rows: StarPlayer[] = await db
		.select({
			slug: starPlayers.slug,
			displayName: starPlayers.displayName,
			category: starPlayers.category
		})
		.from(starPlayers)
		.orderBy(asc(starPlayers.displayName));

	return json({ players: rows });
};
