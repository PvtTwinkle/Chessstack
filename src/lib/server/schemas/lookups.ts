// Query strings for the GET lookup routes (masters, players, stars and the
// trainer's computer move), read with parseQuery.

import { z } from 'zod';
import { fen } from './common';

// Lichess rating brackets 0-7 (see $lib/ratings).
const ratingBracket = z.coerce
	.number({ error: 'rating must be 0-7' })
	.int({ error: 'rating must be 0-7' })
	.min(0, { error: 'rating must be 0-7' })
	.max(7, { error: 'rating must be 0-7' });

/** GET /api/players */
export const playersQuerySchema = z.object({ fen, rating: ratingBracket });

/** GET /api/stars */
export const starsQuerySchema = z.object({ fen, player: z.string().trim().min(1).max(50) });

/**
 * GET /api/train/computer-move. source defaults to players, which also needs
 * a rating bracket.
 */
export const computerMoveQuerySchema = z.preprocess(
	(query) => ({ source: 'players', ...(query as object) }),
	z.discriminatedUnion(
		'source',
		[
			z.object({ fen, source: z.literal('players'), rating: ratingBracket }),
			z.object({ fen, source: z.literal('masters') })
		],
		{ error: 'source must be "players" or "masters"' }
	)
);
