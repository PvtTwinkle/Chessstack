// GET /api/train/computer-move?fen=<fen>&source=players|masters&rating=<0-7>
//
// Selects a single computer move weighted by popularity from the Lichess open
// database (players) or the Chessmont masters database. The probability of
// selecting a move is proportional to its gamesPlayed count — moves that are
// played more often in real games are chosen more frequently.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { lichessMoves, chessmontMoves } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { fenKey } from '$lib/fen';
import { RATE_LIMITS } from '$lib/auth/rate-limit-config';
import { rateLimitResponse, requireAuth } from '$lib/server/api-helpers';
import { parseQuery } from '$lib/server/validation';
import { computerMoveQuerySchema } from '$lib/server/schemas/lookups';

export const GET: RequestHandler = async ({ url, locals }) => {
	const user = requireAuth(locals);

	const limited = await rateLimitResponse(user.id, RATE_LIMITS.computerMove);
	if (limited) return limited;

	const query = parseQuery(url, computerMoveQuerySchema);
	const normalizedFen = fenKey(query.fen);

	let rows: { moveSan: string; resultingFen: string; gamesPlayed: number }[];

	if (query.source === 'players') {
		rows = await db
			.select({
				moveSan: lichessMoves.moveSan,
				resultingFen: lichessMoves.resultingFen,
				gamesPlayed: lichessMoves.gamesPlayed
			})
			.from(lichessMoves)
			.where(
				and(
					eq(lichessMoves.positionFen, normalizedFen),
					eq(lichessMoves.ratingBracket, query.rating)
				)
			);
	} else {
		rows = await db
			.select({
				moveSan: chessmontMoves.moveSan,
				resultingFen: chessmontMoves.resultingFen,
				gamesPlayed: chessmontMoves.gamesPlayed
			})
			.from(chessmontMoves)
			.where(eq(chessmontMoves.positionFen, normalizedFen));
	}

	if (rows.length === 0) {
		return json({ noMoves: true });
	}

	// Weighted random selection: probability proportional to gamesPlayed
	const totalGames = rows.reduce((sum, r) => sum + r.gamesPlayed, 0);
	const roll = Math.random() * totalGames;

	let cumulative = 0;
	for (const row of rows) {
		cumulative += row.gamesPlayed;
		if (roll < cumulative) {
			return json({
				san: row.moveSan,
				resultingFen: row.resultingFen,
				gamesPlayed: row.gamesPlayed,
				totalGames
			});
		}
	}

	// Fallback (should not reach here due to floating point, but just in case)
	const last = rows[rows.length - 1];
	return json({
		san: last.moveSan,
		resultingFen: last.resultingFen,
		gamesPlayed: last.gamesPlayed,
		totalGames
	});
};
