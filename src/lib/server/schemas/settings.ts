// Request body for PATCH /api/settings.
//
// Every field is optional; a request updates only the fields it sends. A
// value of the wrong type or outside a fixed list is rejected, while numeric
// settings are rounded and clamped to their range.

import { z } from 'zod';
import { TOTAL_STEPS } from '$lib/components/tutorial/tutorialSteps';
import { clampedInt } from './common';
import {
	MAX_STOCKFISH_DEPTH,
	MAX_STOCKFISH_TIMEOUT_S,
	MIN_STOCKFISH_DEPTH,
	MIN_STOCKFISH_TIMEOUT_S,
	PLATFORM_USERNAME_MAX_LENGTH,
	TEMPO_SECONDS_RANGE,
	PLAYBACK_SPEED_RANGE,
	FSRS_RETENTION_RANGE,
	FSRS_MAX_INTERVAL_RANGE,
	FSRS_RELEARNING_RANGE,
	TRAINER_RATING_RANGE,
	PUZZLE_GOAL_RANGE
} from '$lib/validation-limits';

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
		stockfishTimeout: clampedInt(MIN_STOCKFISH_TIMEOUT_S, MAX_STOCKFISH_TIMEOUT_S),
		boardTheme: z.enum(['brown', 'blue', 'green', 'purple', 'grey']),
		lichessUsername: handle('lichessUsername', PLATFORM_USERNAME_MAX_LENGTH),
		chesscomUsername: handle('chesscomUsername', PLATFORM_USERNAME_MAX_LENGTH),
		// null clears the goal (the route also clears its frequency).
		puzzleGoalCount: clampedInt(PUZZLE_GOAL_RANGE.min, PUZZLE_GOAL_RANGE.max).nullable(),
		puzzleGoalFrequency: z.enum(['daily', 'weekly', 'monthly']),
		tempoEnabled: z.boolean(),
		tempoSeconds: clampedInt(TEMPO_SECONDS_RANGE.min, TEMPO_SECONDS_RANGE.max),
		// Auto-play delay in milliseconds.
		playbackSpeed: clampedInt(PLAYBACK_SPEED_RANGE.min, PLAYBACK_SPEED_RANGE.max),
		appTheme: z.enum(['dark', 'light']),
		// Gap finder minimum master games.
		gapMinGames: z.literal([10, 100, 1000, 10000, 100000]),
		playersRatingBracket: clampedInt(0, 7),
		// 0 means auto (fill the container); otherwise pixels.
		boardSize: z.number().transform((v) => {
			const px = Math.round(v);
			return px === 0 ? 0 : Math.max(320, Math.min(800, px));
		}),
		fsrsDesiredRetention: z
			.number()
			.transform((v) =>
				Math.max(
					FSRS_RETENTION_RANGE.min,
					Math.min(FSRS_RETENTION_RANGE.max, Math.round(v * 100) / 100)
				)
			),
		// Days.
		fsrsMaximumInterval: clampedInt(FSRS_MAX_INTERVAL_RANGE.min, FSRS_MAX_INTERVAL_RANGE.max),
		// Minutes.
		fsrsRelearningMinutes: clampedInt(FSRS_RELEARNING_RANGE.min, FSRS_RELEARNING_RANGE.max),
		starsPlayerSlug: handle('starsPlayerSlug', 50),
		trainerRating: clampedInt(TRAINER_RATING_RANGE.min, TRAINER_RATING_RANGE.max).nullable(),
		// null means the tutorial was completed or skipped.
		tutorialStep: clampedInt(0, TOTAL_STEPS - 1).nullable()
	})
	.partial()
	.refine((body) => Object.keys(body).length > 0, {
		error: 'No recognised settings fields provided'
	});

export type SettingsUpdate = z.output<typeof updateSettingsSchema>;
