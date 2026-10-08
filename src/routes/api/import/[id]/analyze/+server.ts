// POST /api/import/:id/analyze — analyze an imported game against all matching repertoires.
//
// Loads the imported game's PGN, finds all repertoires matching the player color,
// runs analyzeGame() against each, and returns a summary so the client can show
// a repertoire picker if multiple match.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { importedGame, repertoire, userMove } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { parsePgn, analyzeGame, computeMatchDepth } from '$lib/pgn';
import { isRateLimited } from '$lib/auth/rate-limit';
import { RATE_LIMITS } from '$lib/auth/rate-limit-config';
import { requireAuth, parseIntParam } from '$lib/server/api-helpers';

/** Format the first N half-moves as readable notation, e.g. "1. e4 e5 2. Nf3 Nc6". */
function formatOpeningMoves(moves: { san: string }[], plies = 4): string {
	const slice = moves.slice(0, plies);
	let result = '';
	for (let i = 0; i < slice.length; i++) {
		if (i % 2 === 0) result += `${Math.floor(i / 2) + 1}. `;
		result += slice[i].san;
		if (i < slice.length - 1) result += ' ';
	}
	return result || '(empty game)';
}

interface RepertoireAnalysis {
	repertoireId: number;
	repertoireName: string;
	issueCount: number;
	firstDeviationFen: string | null;
	matchDepth: number;
}

export const POST: RequestHandler = async ({ locals, params }) => {
	const user = requireAuth(locals);

	if (await isRateLimited(String(user.id), RATE_LIMITS.importAnalyze)) {
		return json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
	}

	const id = parseIntParam(params.id, 'game ID');

	// Load the imported game and verify ownership.
	const [game] = await db
		.select()
		.from(importedGame)
		.where(and(eq(importedGame.id, id), eq(importedGame.userId, user.id)));

	if (!game) throw error(404, 'Game not found');

	// Parse the PGN.
	let parsed;
	try {
		parsed = parsePgn(game.pgn);
	} catch (e) {
		throw error(400, `Invalid PGN: ${e instanceof Error ? e.message : String(e)}`);
	}

	// Format the first 2 full moves for error messages so the user knows
	// which opening they need a repertoire for.
	const openingMoves = formatOpeningMoves(parsed.moves);

	// Find all repertoires matching the player color.
	const color = game.playerColor as 'WHITE' | 'BLACK';
	const matchingReps = await db
		.select()
		.from(repertoire)
		.where(and(eq(repertoire.userId, user.id), eq(repertoire.color, color)));

	if (matchingReps.length === 0) {
		return json({
			game,
			analyses: [] as RepertoireAnalysis[],
			message: `No ${color.toLowerCase()} repertoires found for this game (${openingMoves}). Create one first.`
		});
	}

	// Analyze against each matching repertoire, scoring by opening overlap.
	const analyses: RepertoireAnalysis[] = [];

	for (const rep of matchingReps) {
		const moves = await db
			.select()
			.from(userMove)
			.where(and(eq(userMove.userId, user.id), eq(userMove.repertoireId, rep.id)));

		const matchDepth = computeMatchDepth(parsed.moves, moves, color);

		// Skip repertoires that don't cover the game's opening at all.
		if (matchDepth === 0) continue;

		const analysis = analyzeGame(parsed, moves, color);
		analyses.push({
			repertoireId: rep.id,
			repertoireName: rep.name,
			issueCount: analysis.issues.length,
			firstDeviationFen: analysis.firstDeviationFen,
			matchDepth
		});
	}

	// Sort by match depth descending — the best opening match first.
	analyses.sort((a, b) => b.matchDepth - a.matchDepth);

	// If same-color repertoires exist but none match this game's opening,
	// tell the user to create one for this opening.
	if (analyses.length === 0) {
		return json({
			game,
			analyses,
			message: `None of your ${color.toLowerCase()} repertoires match this game's opening (${openingMoves}). Create one first.`
		});
	}

	return json({ game, analyses });
};
