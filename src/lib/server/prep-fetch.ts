// Fetching an opponent's games for prep, shared by creating a prep
// (/api/prep/fetch) and refreshing one (/api/prep/:id/refresh).
//
// Unlike the user's own import, prep wants the most recent games: the cap
// drops the oldest, "All time" reads every Chess.com archive, and Lichess
// variant games are left out (the worker skips any that still get through).

import { fetchLichessGames, STANDARD_PERF_TYPES } from '$lib/lichess';
import { fetchChesscomGames } from '$lib/chesscom';
import { timeWindowToSince } from '$lib/prep/timeWindow';

export interface OpponentGames {
	pgns: string[];
	gameCount: number;
	/** More games than `maxGames` exist in the window. */
	hasMore: boolean;
}

/**
 * Fetches up to `maxGames` of the opponent's newest games in `timeWindow`.
 * Throws LichessApiError / ChesscomApiError as the clients do.
 */
export async function fetchOpponentGames(
	platform: 'LICHESS' | 'CHESSCOM',
	username: string,
	timeWindow: string | undefined,
	maxGames: number
): Promise<OpponentGames> {
	const since = timeWindowToSince(timeWindow);
	// One extra game tells us whether the cap cut anything.
	const max = maxGames + 1;
	const games =
		platform === 'LICHESS'
			? await fetchLichessGames(username, {
					since,
					max,
					sort: 'dateDesc',
					perfType: STANDARD_PERF_TYPES
				})
			: await fetchChesscomGames(username, {
					since: since === undefined ? undefined : new Date(since),
					max,
					allArchives: true,
					newestFirst: true
				});

	const hasMore = games.length > maxGames;
	const pgns = (hasMore ? games.slice(0, maxGames) : games).map((g) => g.pgn);
	return { pgns, gameCount: pgns.length, hasMore };
}
