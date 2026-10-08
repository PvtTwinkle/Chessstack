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
import { fetchLichessGames, LichessApiError } from '$lib/lichess';
import { fetchChesscomGames, ChesscomApiError } from '$lib/chesscom';
import { timeWindowToSince } from '$lib/prep/timeWindow';
import { parseBody } from '$lib/server/validation';
import { fetchOpponentGamesSchema } from '$lib/server/schemas/prep';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const { opponentUsername, platform, timeWindow, maxGames } = await parseBody(
		request,
		fetchOpponentGamesSchema
	);

	const since = timeWindowToSince(timeWindow ?? undefined);
	const sinceDate = since ? new Date(since) : undefined;

	try {
		let games;
		if (platform === 'LICHESS') {
			games = await fetchLichessGames(opponentUsername, {
				since,
				max: maxGames + 1,
				sort: 'dateDesc'
			});
		} else {
			games = await fetchChesscomGames(opponentUsername, {
				since: sinceDate,
				max: maxGames + 1
			});
		}

		const hasMore = games.length > maxGames;
		const trimmed = hasMore ? games.slice(0, maxGames) : games;
		const pgns = trimmed.map((g) => g.pgn);
		return json({ pgns, gameCount: pgns.length, hasMore });
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
