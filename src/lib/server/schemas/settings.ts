// Request body for PATCH /api/settings.
//
// Every field is optional; a request updates only the fields it sends. A
// value of the wrong type or outside a fixed list is rejected, while numeric
// settings are rounded and clamped to their range.

import { z } from 'zod';
import { TOTAL_STEPS } from '$lib/components/tutorial/tutorialSteps';
import { clampedInt } from './common';
import { MAX_STOCKFISH_DEPTH, MIN_STOCKFISH_DEPTH } from '$lib/validation-limits';

/** A username or slug; empty, blank or null clears it. */
function handle(field: string, maxLength: number) {
	return z
		.string()
		.trim()
		.max(maxLength)
		.regex(/^[a-zA-Z0-9_-]*$/, {
			error: `${field} may only contain letters, digits, - and _`
		})
		.nullable()
		.transform((v) => (v === '' ? null : v));
}

export const updateSettingsSchema = z
	.object({
		soundEnabled: z.boolean(),
		stockfishDepth: clampedInt(MIN_STOCKFISH_DEPTH, MAX_STOCKFISH_DEPTH),
		stockfishTimeout: clampedInt(3, 30),
		boardTheme: z.enum(['brown', 'blue', 'green', 'purple', 'grey']),
		lichessUsername: handle('lichessUsername', 25),
		chesscomUsername: handle('chesscomUsername', 25),
		// null clears the goal (the route also clears its frequency).
		puzzleGoalCount: clampedInt(1, 999).nullable(),
		puzzleGoalFrequency: z.enum(['daily', 'weekly', 'monthly']),
		tempoEnabled: z.boolean(),
		tempoSeconds: clampedInt(3, 30),
		// Auto-play delay in milliseconds.
		playbackSpeed: clampedInt(200, 2000),
		appTheme: z.enum(['dark', 'light']),
		// Gap finder minimum master games.
		gapMinGames: z.literal([10, 100, 1000, 10000]),
		playersRatingBracket: clampedInt(0, 7),
		// 0 means auto (fill the container); otherwise pixels.
		boardSize: z.number().transform((v) => {
			const px = Math.round(v);
			return px === 0 ? 0 : Math.max(320, Math.min(800, px));
		}),
		fsrsDesiredRetention: z
			.number()
			.transform((v) => Math.max(0.7, Math.min(0.97, Math.round(v * 100) / 100))),
		// Days.
		fsrsMaximumInterval: clampedInt(30, 3650),
		// Minutes.
		fsrsRelearningMinutes: clampedInt(1, 60),
		starsPlayerSlug: handle('starsPlayerSlug', 50),
		trainerRating: clampedInt(100, 3000).nullable(),
		// null means the tutorial was completed or skipped.
		tutorialStep: clampedInt(0, TOTAL_STEPS - 1).nullable()
	})
	.partial()
	.refine((body) => Object.keys(body).length > 0, {
		error: 'No recognised settings fields provided'
	});

export type SettingsUpdate = z.output<typeof updateSettingsSchema>;
