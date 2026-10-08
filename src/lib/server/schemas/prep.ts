// Request bodies for /api/prep (opponent prep) routes.

import { z } from 'zod';
import { clampedInt, fen, id } from './common';

const platform = z.enum(['LICHESS', 'CHESSCOM']);
const timeWindow = z.enum(['1m', '3m', '6m', '1y', 'all']);
const prepColor = z.enum(['white', 'black']);
const gameCount = z.number().int().min(0);

/** How many games to fetch; a cleared input falls back to 500. */
const maxGames = clampedInt(50, 5000)
	.nullish()
	.transform((v) => v ?? 500);

/** One aggregated opponent move, as produced by the PGN-parsing Web Worker. */
export const aggregatedMove = z.object({
	positionFen: fen,
	moveSan: z.string().min(1),
	// The colour the opponent played in these games.
	opponentColor: z.enum(['w', 'b']),
	resultingFen: fen,
	gamesPlayed: gameCount,
	whiteWins: gameCount,
	blackWins: gameCount,
	draws: gameCount
});

/** POST /api/prep */
export const createPrepSchema = z.object({
	opponentName: z.string().min(1).max(100),
	platform,
	platformUsername: z.string().min(1),
	timeWindow: timeWindow.nullish(),
	gamesAsWhite: gameCount.optional(),
	gamesAsBlack: gameCount.optional(),
	moves: z.array(aggregatedMove)
});

/** PATCH /api/prep/[id] */
export const updatePrepSchema = z
	.object({
		minGames: clampedInt(1, 100),
		excludedMoves: z.array(z.string())
	})
	.partial()
	.refine((body) => body.minGames !== undefined || body.excludedMoves !== undefined, {
		error: 'No valid fields to update'
	});

/**
 * POST /api/prep/[id]/add-to-repertoire. 'preview' only reports conflicts;
 * 'execute' writes, replacing the existing move wherever replacements lists
 * the prep move for that position.
 */
export const addPrepToRepertoireSchema = z.object({
	mode: z.enum(['preview', 'execute']),
	repertoireId: id,
	color: prepColor,
	replacements: z.array(z.object({ fromFen: fen, san: z.string().min(1) })).default([])
});

/** POST /api/prep/[id]/export */
export const exportPrepSchema = z.object({ color: prepColor });

/** POST /api/prep/[id]/moves */
export const addPrepMoveSchema = z.object({
	fromFen: z
		.string({ error: 'Invalid FEN' })
		.trim()
		.min(1, { error: 'Invalid FEN' })
		.max(100, { error: 'Invalid FEN' }),
	san: z.string().min(1),
	color: prepColor
});

/** DELETE /api/prep/[id]/moves */
export const deletePrepMoveSchema = z.object({ moveId: id });

/**
 * POST /api/prep/[id]/refresh, in three modes: 'fetch' returns new PGNs,
 * then 'merge-start' clears the old move data and 'merge-batch' inserts the
 * re-aggregated moves a chunk at a time.
 */
export const refreshPrepSchema = z.discriminatedUnion(
	'mode',
	[
		z.object({ mode: z.literal('fetch'), timeWindow: timeWindow.nullish(), maxGames }),
		z.object({
			mode: z.literal('merge-start'),
			gamesAsWhite: gameCount.default(0),
			gamesAsBlack: gameCount.default(0)
		}),
		z.object({ mode: z.literal('merge-batch'), moves: z.array(aggregatedMove).min(1) })
	],
	{ error: 'mode must be "fetch", "merge-start", or "merge-batch"' }
);

/** POST /api/prep/fetch */
export const fetchOpponentGamesSchema = z.object({
	opponentUsername: z.string().min(1).max(50),
	platform,
	timeWindow: timeWindow.nullish(),
	maxGames
});
