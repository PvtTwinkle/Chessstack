// POST /api/train/evaluate
//
// Scores a finished training game from the final-position evaluation the
// browser's Stockfish sends, optionally updates the user's trainer rating, and
// saves the session to trainer_session. The rating is private to each user, so
// trusting the browser's score only lets a user fool themselves.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { userSettings, trainerSession } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { evalToScore, computeRatingChange, bracketMidpoint } from '$lib/trainer';
import type { TrainerEvalResult } from '$lib/trainer';
import { parseBody } from '$lib/server/validation';
import { trainerEvaluateSchema } from '$lib/server/schemas/train';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const {
		evalCp,
		evalMate,
		rated,
		repertoireId,
		pgn,
		movesPlayed,
		startFen,
		moveSource,
		playerColor,
		ratingBracket
	} = await parseBody(request, trainerEvaluateSchema);

	const userId = locals.user.id;
	const isRated = rated === true;

	// Load the user's current trainer rating
	const [settings] = await db
		.select({ trainerRating: userSettings.trainerRating })
		.from(userSettings)
		.where(eq(userSettings.userId, userId));

	const currentRating = settings?.trainerRating ?? 1200;

	const result: TrainerEvalResult = {
		evalCp: null,
		score: null,
		ratingBefore: null,
		ratingAfter: null,
		ratingChange: null
	};

	// A mate counts as a decisive result (mate 0 isn't a real score).
	if (evalMate != null && evalMate !== 0) {
		result.evalCp = evalMate > 0 ? Infinity : -Infinity;
	} else if (evalCp != null) {
		result.evalCp = evalCp;
	}

	if (result.evalCp != null) {
		result.score = evalToScore(result.evalCp, playerColor);

		if (isRated && settings) {
			// Use bracket midpoint as opponent rating for Elo calculation.
			// Masters mode uses null bracket (midpoint defaults to 2500).
			const opponentMid = bracketMidpoint(ratingBracket ?? null);
			const ratingChange = computeRatingChange(result.score, opponentMid, currentRating);
			result.ratingBefore = currentRating;
			result.ratingAfter = Math.max(100, currentRating + ratingChange);
			result.ratingChange = result.ratingAfter - result.ratingBefore;

			// Update the user's trainer rating
			await db
				.update(userSettings)
				.set({ trainerRating: result.ratingAfter, updatedAt: new Date() })
				.where(eq(userSettings.userId, userId));
		}
	}

	// Save the trainer session regardless of whether eval succeeded
	// Store Infinity/-Infinity as large sentinel values for DB storage
	let storedEvalCp: number | null = null;
	if (result.evalCp != null) {
		if (result.evalCp === Infinity) storedEvalCp = 99999;
		else if (result.evalCp === -Infinity) storedEvalCp = -99999;
		else storedEvalCp = Math.round(result.evalCp);
	}

	await db.insert(trainerSession).values({
		userId,
		repertoireId,
		startFen,
		pgn,
		movesPlayed,
		finalEvalCp: storedEvalCp,
		rated: isRated,
		ratingBefore: result.ratingBefore,
		ratingAfter: result.ratingAfter,
		moveSource,
		completedAt: new Date()
	});

	return json(result);
};
