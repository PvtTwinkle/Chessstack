// PATCH /api/settings — update one or more user settings fields.
//
// Supports: { soundEnabled: boolean, stockfishDepth: number, stockfishTimeout: number, boardTheme: string }
// Returns the updated settings row.
//
// The user must be authenticated; settings are scoped to locals.user.id.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { userSettings } from '$lib/db/schema';
import { TOTAL_STEPS } from '$lib/components/tutorial/tutorialSteps';
import { eq } from 'drizzle-orm';

export const PATCH: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	let body;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}

	// Build an update object with only the fields we recognise and received.
	// This pattern makes it easy to extend with more settings later without
	// changing the logic — just add a new recognised field here.
	const updates: Partial<typeof userSettings.$inferInsert> = {};

	if (typeof body.soundEnabled === 'boolean') {
		updates.soundEnabled = body.soundEnabled;
	}

	// Stockfish analysis depth: integer clamped to 15–30.
	if (typeof body.stockfishDepth === 'number') {
		updates.stockfishDepth = Math.max(15, Math.min(30, Math.round(body.stockfishDepth)));
	}

	// Stockfish analysis timeout: integer clamped to 3–30 seconds.
	if (typeof body.stockfishTimeout === 'number') {
		updates.stockfishTimeout = Math.max(3, Math.min(30, Math.round(body.stockfishTimeout)));
	}

	// Board theme: must be one of the known theme names.
	const VALID_THEMES = ['brown', 'blue', 'green', 'purple', 'grey'];
	if (typeof body.boardTheme === 'string' && VALID_THEMES.includes(body.boardTheme)) {
		updates.boardTheme = body.boardTheme;
	}

	// Lichess username: alphanumeric + hyphens + underscores, max 25 chars.
	// Empty string or null clears the username.
	if (body.lichessUsername !== undefined) {
		if (body.lichessUsername === null || body.lichessUsername === '') {
			updates.lichessUsername = null;
		} else if (typeof body.lichessUsername === 'string') {
			const cleaned = body.lichessUsername.trim();
			if (cleaned.length > 0 && cleaned.length <= 25 && /^[a-zA-Z0-9_-]+$/.test(cleaned)) {
				updates.lichessUsername = cleaned;
			}
		}
	}

	// Chess.com username: same validation pattern.
	if (body.chesscomUsername !== undefined) {
		if (body.chesscomUsername === null || body.chesscomUsername === '') {
			updates.chesscomUsername = null;
		} else if (typeof body.chesscomUsername === 'string') {
			const cleaned = body.chesscomUsername.trim();
			if (cleaned.length > 0 && cleaned.length <= 25 && /^[a-zA-Z0-9_-]+$/.test(cleaned)) {
				updates.chesscomUsername = cleaned;
			}
		}
	}

	// Puzzle goal count: positive integer 1–999, or null to clear the goal.
	if (body.puzzleGoalCount !== undefined) {
		if (body.puzzleGoalCount === null) {
			updates.puzzleGoalCount = null;
			updates.puzzleGoalFrequency = null;
		} else if (typeof body.puzzleGoalCount === 'number') {
			updates.puzzleGoalCount = Math.max(1, Math.min(999, Math.round(body.puzzleGoalCount)));
		}
	}

	// Puzzle goal frequency: must be one of the known period names.
	const VALID_FREQUENCIES = ['daily', 'weekly', 'monthly'];
	if (
		typeof body.puzzleGoalFrequency === 'string' &&
		VALID_FREQUENCIES.includes(body.puzzleGoalFrequency)
	) {
		updates.puzzleGoalFrequency = body.puzzleGoalFrequency;
	}

	// Tempo training: boolean toggle.
	if (typeof body.tempoEnabled === 'boolean') {
		updates.tempoEnabled = body.tempoEnabled;
	}

	// Tempo training time limit: integer clamped to 3–30 seconds.
	if (typeof body.tempoSeconds === 'number') {
		updates.tempoSeconds = Math.max(3, Math.min(30, Math.round(body.tempoSeconds)));
	}

	// Playback speed: auto-play delay in milliseconds, clamped to 200–2000.
	if (typeof body.playbackSpeed === 'number') {
		updates.playbackSpeed = Math.max(200, Math.min(2000, Math.round(body.playbackSpeed)));
	}

	// App theme: dark or light mode.
	const VALID_APP_THEMES = ['dark', 'light'];
	if (typeof body.appTheme === 'string' && VALID_APP_THEMES.includes(body.appTheme)) {
		updates.appTheme = body.appTheme;
	}

	// Gap finder minimum games (sample-size floor, within the rating window):
	// must be one of the preset values.
	const VALID_GAP_MIN_GAMES = [10, 100, 1000, 10000, 100000];
	if (typeof body.gapMinGames === 'number' && VALID_GAP_MIN_GAMES.includes(body.gapMinGames)) {
		updates.gapMinGames = body.gapMinGames;
	}

	// Gap finder minimum popularity: % of games at the position, must be a preset value.
	const VALID_GAP_MIN_POPULARITY_PCT = [1, 2, 5, 10, 20];
	if (
		typeof body.gapMinPopularityPct === 'number' &&
		VALID_GAP_MIN_POPULARITY_PCT.includes(body.gapMinPopularityPct)
	) {
		updates.gapMinPopularityPct = body.gapMinPopularityPct;
	}

	// Players tab rating bracket: integer 0–7.
	if (typeof body.playersRatingBracket === 'number') {
		updates.playersRatingBracket = Math.max(0, Math.min(7, Math.round(body.playersRatingBracket)));
	}

	// Board size: 0 = auto (fill container), positive integer clamped to 320–800px.
	if (typeof body.boardSize === 'number') {
		const val = Math.round(body.boardSize);
		updates.boardSize = val === 0 ? 0 : Math.max(320, Math.min(800, val));
	}

	// FSRS desired retention: float clamped to 0.70–0.97.
	if (typeof body.fsrsDesiredRetention === 'number') {
		const val = Math.round(body.fsrsDesiredRetention * 100) / 100;
		updates.fsrsDesiredRetention = Math.max(0.7, Math.min(0.97, val));
	}

	// FSRS maximum interval: integer clamped to 30–3650 days.
	if (typeof body.fsrsMaximumInterval === 'number') {
		updates.fsrsMaximumInterval = Math.max(
			30,
			Math.min(3650, Math.round(body.fsrsMaximumInterval))
		);
	}

	// FSRS relearning delay: integer clamped to 1–60 minutes.
	if (typeof body.fsrsRelearningMinutes === 'number') {
		updates.fsrsRelearningMinutes = Math.max(
			1,
			Math.min(60, Math.round(body.fsrsRelearningMinutes))
		);
	}

	// Stars tab player: slug string (alphanumeric + hyphens, max 50 chars), or null to clear.
	if (body.starsPlayerSlug !== undefined) {
		if (body.starsPlayerSlug === null || body.starsPlayerSlug === '') {
			updates.starsPlayerSlug = null;
		} else if (typeof body.starsPlayerSlug === 'string') {
			const cleaned = body.starsPlayerSlug.trim();
			if (cleaned.length > 0 && cleaned.length <= 50 && /^[a-zA-Z0-9_-]+$/.test(cleaned)) {
				updates.starsPlayerSlug = cleaned;
			}
		}
	}

	// Trainer rating: integer clamped to 100–3000, or null to clear.
	if (body.trainerRating !== undefined) {
		if (body.trainerRating === null) {
			updates.trainerRating = null;
		} else if (typeof body.trainerRating === 'number') {
			updates.trainerRating = Math.max(100, Math.min(3000, Math.round(body.trainerRating)));
		}
	}

	// Tutorial step: null = completed/skipped, integer 0–9 = active step.
	if (body.tutorialStep !== undefined) {
		if (body.tutorialStep === null) {
			updates.tutorialStep = null;
		} else if (typeof body.tutorialStep === 'number') {
			updates.tutorialStep = Math.max(0, Math.min(TOTAL_STEPS - 1, Math.round(body.tutorialStep)));
		}
	}

	if (Object.keys(updates).length === 0) {
		throw error(400, 'No recognised settings fields provided');
	}

	updates.updatedAt = new Date();

	// Upsert: update if a row exists, insert a defaults row first if not.
	const [existing] = await db
		.select()
		.from(userSettings)
		.where(eq(userSettings.userId, locals.user.id));

	if (existing) {
		await db.update(userSettings).set(updates).where(eq(userSettings.userId, locals.user.id));
	} else {
		// updatedAt is required on insert but lives in the partial `updates` object.
		// Provide it explicitly so Drizzle's types are satisfied.
		await db
			.insert(userSettings)
			.values({ userId: locals.user.id, updatedAt: new Date(), ...updates });
	}

	const [updated] = await db
		.select()
		.from(userSettings)
		.where(eq(userSettings.userId, locals.user.id));

	return json({ updated: true, settings: updated });
};
