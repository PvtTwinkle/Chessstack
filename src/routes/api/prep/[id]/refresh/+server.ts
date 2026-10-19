// POST /api/prep/:id/refresh — fetch an opponent's games and replace a prep's
// move data with them.
//
// 1. mode 'fetch' returns PGN strings for client-side worker parsing (same as
//    /api/prep/fetch), using the chosen time window.
// 2. mode 'merge-start' opens a pending upload for the new data and returns
//    its id. 'merge-batch' (on the upload's id) adds a chunk of moves, and
//    'merge-commit' swaps them in, so a refresh that fails partway leaves the
//    old data untouched. A new prep uses the last two steps the same way: POST
//    /api/prep creates it as a pending upload.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { opponentPreps, opponentMoves } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { LichessApiError } from '$lib/lichess';
import { ChesscomApiError } from '$lib/chesscom';
import { fenKey } from '$lib/fen';
import { fetchOpponentGames } from '$lib/server/prep-fetch';
import { parseBody } from '$lib/server/validation';
import { refreshPrepSchema } from '$lib/server/schemas/prep';
import { deleteStaleUploads, publishPrepUpload } from '$lib/server/prep-upload';
import { parseIntParam, rateLimitResponse, requireAuth } from '$lib/server/api-helpers';
import { RATE_LIMITS } from '$lib/auth/rate-limit-config';

export const POST: RequestHandler = async ({ locals, params, request }) => {
	const user = requireAuth(locals);

	const prepId = parseIntParam(params.id, 'prep ID');

	// Verify ownership
	const [prep] = await db
		.select()
		.from(opponentPreps)
		.where(and(eq(opponentPreps.id, prepId), eq(opponentPreps.userId, user.id)));

	if (!prep) throw error(404, 'Prep not found');

	const body = await parseBody(request, refreshPrepSchema);

	const pending = prep.pendingSince !== null;
	// Batches and the commit go to a pending upload; everything else to a live prep.
	if (pending !== (body.mode === 'merge-batch' || body.mode === 'merge-commit')) {
		throw error(409, pending ? 'This upload is not finished' : 'This prep is not an upload');
	}

	if (body.mode === 'fetch') {
		const limited = await rateLimitResponse(user.id, RATE_LIMITS.prepFetch);
		if (limited) return limited;

		// A refresh replaces the data, so it re-reads the whole window (the
		// prep's own one when none is given), not just games since the last fetch.
		const timeWindow = body.timeWindow ?? prep.timeWindow ?? undefined;
		const platform = prep.platform === 'LICHESS' ? 'LICHESS' : 'CHESSCOM';

		try {
			return json(
				await fetchOpponentGames(platform, prep.platformUsername, timeWindow, body.maxGames)
			);
		} catch (e) {
			if (e instanceof LichessApiError || e instanceof ChesscomApiError) {
				if (e.status === 429) {
					return json(
						{ pgns: [], gameCount: 0, hasMore: false, rateLimited: true },
						{ status: 429 }
					);
				}
				if (e.status === 404) {
					throw error(404, `User "${prep.platformUsername}" not found`);
				}
			}
			throw error(502, `Failed to fetch games: ${e instanceof Error ? e.message : String(e)}`);
		}
	} else if (body.mode === 'merge-start') {
		await deleteStaleUploads(user.id, prepId);

		const [upload] = await db
			.insert(opponentPreps)
			.values({
				userId: user.id,
				opponentName: prep.opponentName,
				platform: prep.platform,
				platformUsername: prep.platformUsername,
				timeWindow: prep.timeWindow,
				lastFetchedAt: prep.lastFetchedAt,
				createdAt: new Date(),
				pendingSince: new Date(),
				replacesPrepId: prepId
			})
			.returning({ id: opponentPreps.id });

		return json({ uploadId: upload.id });
	} else if (body.mode === 'merge-batch') {
		const { moves } = body;

		await db.insert(opponentMoves).values(
			moves.map((m) => ({
				prepId,
				positionFen: fenKey(m.positionFen),
				moveSan: m.moveSan,
				opponentColor: m.opponentColor,
				resultingFen: fenKey(m.resultingFen),
				gamesPlayed: m.gamesPlayed,
				whiteWins: m.whiteWins,
				blackWins: m.blackWins,
				draws: m.draws
			}))
		);

		return json({ inserted: moves.length });
	} else {
		const { timeWindow, gamesAsWhite, gamesAsBlack } = body;
		const livePrepId = await publishPrepUpload(user.id, prepId, {
			timeWindow,
			gamesAsWhite,
			gamesAsBlack
		});
		if (livePrepId === null) throw error(404, 'Prep not found');

		return json({ prepId: livePrepId });
	}
};
