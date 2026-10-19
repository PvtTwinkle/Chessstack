// Request bodies for /api/prep (opponent prep) routes.

import { z } from 'zod';
import { clampedInt, fen, id, san } from './common';
import {
	FEN_MAX_LENGTH,
	NAME_MAX_LENGTH,
	PLATFORM_USERNAME_MAX_LENGTH,
	PREP_EXCLUDED_MOVES_MAX,
	PREP_UPLOAD_BATCH_MAX,
	SAN_MAX_LENGTH
} from '$lib/validation-limits';

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
	moveSan: san,
	// The colour the opponent played in these games.
	opponentColor: z.enum(['w', 'b']),
	resultingFen: fen,
	gamesPlayed: gameCount,
	whiteWins: gameCount,
	blackWins: gameCount,
	draws: gameCount
});

/**
 * POST /api/prep. Creates the prep as a pending upload: its moves follow in
 * 'merge-batch' requests and 'merge-commit' publishes it.
 */
export const createPrepSchema = z.object({
	opponentName: z.string().min(1).max(NAME_MAX_LENGTH),
	platform,
	platformUsername: z.string().min(1).max(PLATFORM_USERNAME_MAX_LENGTH),
	timeWindow: timeWindow.nullish(),
	gamesAsWhite: gameCount.optional(),
	gamesAsBlack: gameCount.optional()
});

/** PATCH /api/prep/[id] */
export const updatePrepSchema = z
	.object({
		minGames: clampedInt(1, 100),
		excludedMoves: z
			.array(z.string().max(FEN_MAX_LENGTH + SAN_MAX_LENGTH + 1))
			.max(PREP_EXCLUDED_MOVES_MAX)
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
	replacements: z.array(z.object({ fromFen: fen, san })).default([])
});

/** POST /api/prep/[id]/export */
export const exportPrepSchema = z.object({ color: prepColor });

/** POST /api/prep/[id]/moves */
export const addPrepMoveSchema = z.object({
	fromFen: z
		.string({ error: 'Invalid FEN' })
		.trim()
		.min(1, { error: 'Invalid FEN' })
		.max(FEN_MAX_LENGTH, { error: 'Invalid FEN' }),
	san,
	color: prepColor
});

/** DELETE /api/prep/[id]/moves */
export const deletePrepMoveSchema = z.object({ moveId: id });

/**
 * POST /api/prep/[id]/refresh, in four modes. 'fetch' returns new PGNs.
 * 'merge-start' opens a pending upload that will replace the prep's move data
 * and returns its id; 'merge-batch' adds a chunk of re-aggregated moves to a
 * pending upload (a refresh's, or a new prep's); 'merge-commit' publishes it
 * in one transaction, so the old data stays until the new data is complete.
 */
export const refreshPrepSchema = z.discriminatedUnion(
	'mode',
	[
		z.object({ mode: z.literal('fetch'), timeWindow: timeWindow.nullish(), maxGames }),
		z.object({ mode: z.literal('merge-start') }),
		z.object({
			mode: z.literal('merge-batch'),
			moves: z.array(aggregatedMove).min(1).max(PREP_UPLOAD_BATCH_MAX)
		}),
		z.object({
			mode: z.literal('merge-commit'),
			timeWindow: timeWindow.nullish(),
			gamesAsWhite: gameCount.default(0),
			gamesAsBlack: gameCount.default(0)
		})
	],
	{ error: 'mode must be "fetch", "merge-start", "merge-batch", or "merge-commit"' }
);

/** POST /api/prep/fetch */
export const fetchOpponentGamesSchema = z.object({
	opponentUsername: z.string().min(1).max(PLATFORM_USERNAME_MAX_LENGTH),
	platform,
	timeWindow: timeWindow.nullish(),
	maxGames
});
