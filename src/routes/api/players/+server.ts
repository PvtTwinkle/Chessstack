// GET /api/players?fen=<fen>&rating=<0-7>
//
// Returns move statistics from the Lichess player games database, filtered by
// rating bracket. This is a direct PostgreSQL query — no external API calls,
// no caching layer, no rate limits.
//
// The input FEN is normalized to 4 fields (stripping halfmove clock and
// fullmove number) to match the storage format in lichess_moves.
//
// Each move is additionally annotated with a Stockfish eval of the resulting
// position (see evalCache.ts), so the client can color-code popular moves
// by whether they're actually good, not just popular. The first request for
// a given resulting position computes it live; every request after that is
// a cache hit. Evals are computed sequentially and can dominate response
// time on a cold cache — see evalCache.ts for the depth/timeout trade-off.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { lichessMoves } from '$lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { fenKey } from '$lib/fen';
import { getCachedEval } from '$lib/stockfish/evalCache';
import { Chess } from 'chess.js';
import type { MastersMove, MastersResponse } from '../masters/+server';

const MAX_MOVES = 12;
const EMPTY_RESPONSE: MastersResponse = { moves: [], totalGames: 0 };

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const fen = url.searchParams.get('fen');
	if (!fen) throw error(400, 'fen query parameter is required');
	if (fen.length > 100) throw error(400, 'fen is too long');

	const ratingParam = url.searchParams.get('rating');
	if (ratingParam === null) throw error(400, 'rating query parameter is required');
	const rating = parseInt(ratingParam, 10);
	if (isNaN(rating) || rating < 0 || rating > 7) throw error(400, 'rating must be 0–7');

	const normalizedFen = fenKey(fen);

	const rows = await db
		.select()
		.from(lichessMoves)
		.where(and(eq(lichessMoves.positionFen, normalizedFen), eq(lichessMoves.ratingBracket, rating)))
		.orderBy(desc(lichessMoves.gamesPlayed))
		.limit(MAX_MOVES);

	if (rows.length === 0) return json(EMPTY_RESPONSE);

	// Eval each resulting position, sequentially (Stockfish handles one
	// analysis at a time — see $lib/stockfish/index.ts). Cache hits resolve
	// near-instantly; a cold cache pays the full engine cost per move here.
	const moves: MastersMove[] = [];
	for (const r of rows) {
		let evalCp: number | null = null;
		let evalMate: number | null = null;
		try {
			const whiteMultiplier = new Chess(r.resultingFen).turn() === 'w' ? 1 : -1;
			const positionEval = await getCachedEval(r.resultingFen);
			evalCp = positionEval.evalCp != null ? positionEval.evalCp * whiteMultiplier : null;
			evalMate = positionEval.evalMate != null ? positionEval.evalMate * whiteMultiplier : null;
		} catch {
			// Engine or DB hiccup on this one move — fall through with no eval
			// rather than failing the whole response.
		}

		moves.push({
			san: r.moveSan,
			white: r.whiteWins,
			draws: r.draws,
			black: r.blackWins,
			totalGames: r.gamesPlayed,
			evalCp,
			evalMate
		});
	}

	const totalGames = moves.reduce((sum, m) => sum + m.totalGames, 0);

	return json({ moves, totalGames });
};
