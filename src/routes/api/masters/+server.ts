// GET /api/masters?fen=<fen>
//
// Returns master game move statistics from the local Chessmont database
// (~21.5M games, ELO >= 2500). This is a direct PostgreSQL query with no
// external API calls, rate-limited per user like the other lookup tabs.
//
// The input FEN is normalized to 4 fields (stripping halfmove clock and
// fullmove number) to match the storage format in chessmont_moves and
// to handle transpositions correctly.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { chessmontMoves } from '$lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { fenKey, sanitizeFen } from '$lib/fen';
import { RATE_LIMITS } from '$lib/auth/rate-limit-config';
import { requireAuth, rateLimitResponse } from '$lib/server/api-helpers';
import type { MastersMove, MastersResponse } from '$lib/api-types';

const MAX_MOVES = 12;
const EMPTY_RESPONSE: MastersResponse = { moves: [], totalGames: 0 };

export const GET: RequestHandler = async ({ url, locals }) => {
	const user = requireAuth(locals);

	const limited = await rateLimitResponse(user.id, RATE_LIMITS.masters);
	if (limited) return limited;

	const fen = sanitizeFen(url.searchParams.get('fen'));
	if (!fen) throw error(400, 'fen is required or too long');

	const normalizedFen = fenKey(fen);

	const rows = await db
		.select()
		.from(chessmontMoves)
		.where(eq(chessmontMoves.positionFen, normalizedFen))
		.orderBy(desc(chessmontMoves.gamesPlayed))
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
