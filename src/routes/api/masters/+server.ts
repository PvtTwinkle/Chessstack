// GET /api/masters?fen=<fen>
//
// Returns master game move statistics from the local Chessmont database
// (~21.5M games, ELO >= 2500). This is a direct PostgreSQL query — no
// external API calls, no caching layer, no rate limits.
//
// The input FEN is normalized to 4 fields (stripping halfmove clock and
// fullmove number) to match the storage format in chessmont_moves and
// to handle transpositions correctly.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { chessmontMoves } from '$lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { fenKey } from '$lib/fen';

/** Shape of each move returned to the client. */
export interface MastersMove {
	san: string;
	white: number; // games won by white after this move
	draws: number;
	black: number; // games won by black after this move
	totalGames: number; // white + draws + black
	// Stockfish eval of the resulting position, in white's perspective —
	// same convention as the Engine tab. Populated only by /api/players
	// (see evalCache.ts); undefined for Masters/Stars, which don't compute it.
	evalCp?: number | null;
	evalMate?: number | null;
}

export interface MastersResponse {
	moves: MastersMove[];
	totalGames: number; // aggregate across all moves at this position
}

const MAX_MOVES = 12;
const EMPTY_RESPONSE: MastersResponse = { moves: [], totalGames: 0 };

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const fen = url.searchParams.get('fen');
	if (!fen) throw error(400, 'fen query parameter is required');
	if (fen.length > 100) throw error(400, 'fen is too long');

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
