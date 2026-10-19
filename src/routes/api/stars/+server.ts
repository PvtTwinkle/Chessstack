// GET /api/stars?fen=<fen>&player=<slug>
//
// Returns move statistics for a specific famous player at the given position.
// Queries the local celebrity_moves table (no external API calls), rate-limited
// per user like the other lookup tabs.
//
// The input FEN is normalized to 4 fields (stripping halfmove clock and
// fullmove number) to match the storage format.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { celebrityMoves } from '$lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { fenKey } from '$lib/fen';
import type { MastersMove, MastersResponse } from '$lib/api-types';
import { RATE_LIMITS } from '$lib/auth/rate-limit-config';
import { rateLimitResponse, requireAuth } from '$lib/server/api-helpers';
import { parseQuery } from '$lib/server/validation';
import { starsQuerySchema } from '$lib/server/schemas/lookups';

const MAX_MOVES = 12;
const EMPTY_RESPONSE: MastersResponse = { moves: [], totalGames: 0 };

export const GET: RequestHandler = async ({ url, locals }) => {
	const user = requireAuth(locals);

	const limited = await rateLimitResponse(user.id, RATE_LIMITS.stars);
	if (limited) return limited;

	const { fen, player } = parseQuery(url, starsQuerySchema);

	const normalizedFen = fenKey(fen);

	const rows = await db
		.select()
		.from(celebrityMoves)
		.where(
			and(eq(celebrityMoves.positionFen, normalizedFen), eq(celebrityMoves.playerSlug, player))
		)
		.orderBy(desc(celebrityMoves.gamesPlayed))
		.limit(MAX_MOVES);

	if (rows.length === 0) return json(EMPTY_RESPONSE);

	const moves: MastersMove[] = rows.map((r) => ({
		san: r.moveSan,
		white: r.whiteWins,
		draws: r.draws,
		black: r.blackWins,
		totalGames: r.gamesPlayed
	}));

	const totalGames = moves.reduce((sum, m) => sum + m.totalGames, 0);

	return json({ moves, totalGames });
};
