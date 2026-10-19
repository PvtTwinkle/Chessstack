// POST /api/train/evaluate
//
// Scores a finished training game from the final-position evaluation the
// browser's Stockfish sends, optionally updates the user's trainer rating, and
// saves the session to trainer_session. The rating is private to each user, so
// trusting the browser's score only lets a user fool themselves.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { repertoire, userSettings, trainerSession } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { evalToScore, computeRatingChange, bracketMidpoint } from '$lib/trainer';
import type { TrainerEvalResult } from '$lib/trainer';
import { parseBody } from '$lib/server/validation';
import { trainerEvaluateSchema } from '$lib/server/schemas/train';
import { requireAuth } from '$lib/server/api-helpers';

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = requireAuth(locals);

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

	const userId = user.id;
	const isRated = rated === true;

	// The session row belongs to the repertoire, so it must be the user's own.
	const [rep] = await db
		.select({ id: repertoire.id })
		.from(repertoire)
		.where(and(eq(repertoire.id, repertoireId), eq(repertoire.userId, userId)));
	if (!rep) throw error(404, 'Repertoire not found');

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

	// The rating and the session that explains it are written together.
	await db.transaction(async (tx) => {
		if (result.ratingAfter != null) {
			await tx
				.update(userSettings)
				.set({ trainerRating: result.ratingAfter, updatedAt: new Date() })
				.where(eq(userSettings.userId, userId));
		}
		await tx.insert(trainerSession).values({
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
	});

	// JSON has no Infinity (it would arrive as null), so a mate goes back as
	// the same ±99999 sentinel that is stored, which the trainer shows as mate.
	return json({ ...result, evalCp: storedEvalCp });
};
