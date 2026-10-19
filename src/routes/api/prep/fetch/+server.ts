// POST /api/prep/fetch — fetch an opponent's games from Lichess or Chess.com.
//
// Unlike /api/import/fetch (which fetches the logged-in user's own games),
// this endpoint fetches games for any specified username — the opponent.
// Returns raw PGN strings for client-side parsing via Web Worker.
//
// Body: { opponentUsername: string, platform: 'LICHESS' | 'CHESSCOM', timeWindow?: string }
// Returns: { pgns: string[], gameCount: number }

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { LichessApiError } from '$lib/lichess';
import { ChesscomApiError } from '$lib/chesscom';
import { fetchOpponentGames } from '$lib/server/prep-fetch';
import { parseBody } from '$lib/server/validation';
import { fetchOpponentGamesSchema } from '$lib/server/schemas/prep';
import { rateLimitResponse, requireAuth } from '$lib/server/api-helpers';
import { RATE_LIMITS } from '$lib/auth/rate-limit-config';

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireAuth(locals);

	const limited = await rateLimitResponse(user.id, RATE_LIMITS.prepFetch);
	if (limited) return limited;

	const { opponentUsername, platform, timeWindow, maxGames } = await parseBody(
		request,
		fetchOpponentGamesSchema
	);

	try {
		return json(
			await fetchOpponentGames(platform, opponentUsername, timeWindow ?? undefined, maxGames)
		);
	} catch (e) {
		if (e instanceof LichessApiError || e instanceof ChesscomApiError) {
			if (e.status === 429) {
				return json({ pgns: [], gameCount: 0, hasMore: false, rateLimited: true }, { status: 429 });
			}
			if (e.status === 404) {
				throw error(
					404,
					`User "${opponentUsername}" not found on ${platform === 'LICHESS' ? 'Lichess' : 'Chess.com'}`
				);
			}
		}
		throw error(502, `Failed to fetch games: ${e instanceof Error ? e.message : String(e)}`);
	}
};
