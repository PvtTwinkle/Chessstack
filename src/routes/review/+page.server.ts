// Review mode page server.
//
// LOAD: returns the active repertoire, all its moves, the 20 most recent
//       reviewed games for the history list, user settings, the imported games
//       for the import tab (all pending ones and the first page of the rest),
//       and all repertoires for multi-repertoire analysis.
//       If ?importedGameId=N is in the URL, also loads that specific game for prefill.
//
// ACTION analyzeGame: receives a PGN + player color from the form submission,
//   parses it, runs deviation analysis against the specified (or active) repertoire,
//   and returns the full GameAnalysis to the client. The game is NOT saved to the
//   database here — only when the user clicks "Save Review" (POST /api/review/save).

import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/db';
import { repertoire, userMove, reviewedGame, importedGame, userSettings } from '$lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { parsePgn, analyzeGame, computeMatchDepth, formatOpeningMoves } from '$lib/pgn';
import { isRepertoireLocked } from '$lib/stripe/tiers.server';
import { isRateLimited } from '$lib/auth/rate-limit';
import { RATE_LIMITS } from '$lib/auth/rate-limit-config';
import {
	loadReviewRepertoires,
	type MoveRow,
	type RepertoireRow
} from '$lib/server/review-repertoires';
import { loadImportHistory, loadPendingImports } from '$lib/server/imported-games';

export const load: PageServerLoad = async ({ locals, parent, url }) => {
	const { activeRepertoireId, repertoires, lockedRepertoireIds } = await parent();

	if (!activeRepertoireId) {
		redirect(302, '/');
	}

	const activeRep = repertoires.find((r) => r.id === activeRepertoireId);
	if (!activeRep) {
		redirect(302, '/');
	}

	const userId = locals.user!.id;

	// All moves in the active repertoire — passed to the client so the Svelte
	// component can call analyzeGame via the form action without a second round-trip.
	// (The action re-queries these on submission; the load data is for the history list.)
	const moves = await db
		.select()
		.from(userMove)
		.where(and(eq(userMove.userId, userId), eq(userMove.repertoireId, activeRepertoireId)));

	// Past reviewed games for this repertoire — displayed as a history list on the input screen.
	const recentGames = await db
		.select()
		.from(reviewedGame)
		.where(and(eq(reviewedGame.userId, userId), eq(reviewedGame.repertoireId, activeRepertoireId)))
		.orderBy(desc(reviewedGame.reviewedAt))
		.limit(20);

	// Imported games for the Import tab: every pending one, plus the first
	// page of reviewed and skipped ones (the tab loads more on demand).
	const [pendingImports, importHistory] = await Promise.all([
		loadPendingImports(userId),
		loadImportHistory(userId, 0)
	]);
	const importedGames = [...pendingImports, ...importHistory.games];

	// User settings — needed for platform username display in the import tab.
	const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));

	// If the URL has ?importedGameId=N, load that specific imported game for prefill.
	let prefilledGame = null;
	const importedGameIdParam = url.searchParams.get('importedGameId');
	if (importedGameIdParam) {
		const igId = parseInt(importedGameIdParam);
		if (!isNaN(igId)) {
			const [ig] = await db
				.select()
				.from(importedGame)
				.where(and(eq(importedGame.id, igId), eq(importedGame.userId, userId)));
			if (ig) prefilledGame = ig;
		}
	}

	return {
		repertoire: activeRep,
		moves,
		recentGames,
		importedGames,
		importHistoryHasMore: importHistory.hasMore,
		importSettings: settings
			? {
					lichessUsername: settings.lichessUsername,
					chesscomUsername: settings.chesscomUsername
				}
			: null,
		allRepertoires: repertoires.filter((r) => !lockedRepertoireIds.includes(r.id)),
		prefilledGame
	};
};

export const actions: Actions = {
	analyzeGame: async ({ locals, request }) => {
		if (!locals.user) return fail(401, { error: 'Not authenticated' });
		// Same budget as POST /api/import/[id]/analyze: both parse a game and
		// analyse it against the user's repertoires.
		if (await isRateLimited(String(locals.user.id), RATE_LIMITS.importAnalyze)) {
			return fail(429, { error: 'Too many requests. Please try again later.' });
		}

		const form = await request.formData();
		const pgn = (form.get('pgn') as string | null)?.trim() ?? '';
		const colorOverride = form.get('playerColor') as string | null;
		// Optional explicit repertoire ID — used when reviewing an imported game
		// against a specific repertoire (not necessarily the active one).
		const repertoireIdOverride = form.get('repertoireId') as string | null;

		if (!pgn) return fail(400, { error: 'PGN is required' });

		// Parse PGN first — we need the moves to score repertoire matches.
		let parsed;
		try {
			parsed = parsePgn(pgn);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : String(e) });
		}

		// Format the first 2 full moves for error messages.
		const openingMoves = formatOpeningMoves(parsed.moves);

		// Determine player color. The user can override via the form; otherwise
		// we infer from the explicit repertoire (import flow) or fall back later.
		const playerColor: 'WHITE' | 'BLACK' =
			colorOverride === 'WHITE' || colorOverride === 'BLACK' ? colorOverride : 'WHITE'; // overridden below if we find a repertoire

		let bestRep: RepertoireRow | null;
		let bestMoves: MoveRow[];

		if (repertoireIdOverride) {
			// Import flow — use the explicitly specified repertoire.
			const repId = parseInt(repertoireIdOverride);
			if (isNaN(repId)) return fail(400, { error: 'Invalid repertoireId' });

			const [rep] = await db
				.select()
				.from(repertoire)
				.where(and(eq(repertoire.id, repId), eq(repertoire.userId, locals.user.id)));
			if (!rep) return fail(400, { error: 'Repertoire not found' });

			// Block analysis against locked repertoires for free users.
			if (await isRepertoireLocked(locals.user.id, repId, locals.user.tier ?? 'free')) {
				return fail(403, { error: 'Upgrade your plan to use this repertoire.' });
			}

			bestRep = rep;
			bestMoves = await db
				.select()
				.from(userMove)
				.where(and(eq(userMove.userId, locals.user.id), eq(userMove.repertoireId, rep.id)));
		} else {
			// Paste PGN flow — find the best matching repertoire based on opening,
			// among the user's same-colour repertoires that aren't locked.
			const usable = await loadReviewRepertoires(
				locals.user.id,
				locals.user.tier ?? 'free',
				playerColor
			);

			if (usable.length === 0) {
				return fail(400, {
					error: `No ${playerColor.toLowerCase()} repertoire found for this game (${openingMoves}). Create one first.`
				});
			}

			// Score each repertoire by opening overlap.
			const repData = usable.map(({ rep, moves }) => ({
				rep,
				moves,
				depth: computeMatchDepth(parsed.moves, moves, playerColor)
			}));

			// Pick the repertoire with the deepest opening match.
			repData.sort((a, b) => b.depth - a.depth);
			const best = repData[0];

			if (best.depth > 0) {
				bestRep = best.rep;
				bestMoves = best.moves;
			} else {
				// No repertoire covers the game's opening at all — use the one
				// with the most moves (most likely the user's primary repertoire).
				const bySize = [...repData].sort((a, b) => b.moves.length - a.moves.length);
				bestRep = bySize[0].rep;
				bestMoves = bySize[0].moves;
			}
		}

		if (!bestRep || !bestMoves) {
			return fail(400, { error: 'No matching repertoire found' });
		}

		// Use the matched repertoire's color if the user didn't explicitly override.
		const finalColor: 'WHITE' | 'BLACK' =
			colorOverride === 'WHITE' || colorOverride === 'BLACK'
				? colorOverride
				: (bestRep.color as 'WHITE' | 'BLACK');

		const analysis = analyzeGame(parsed, bestMoves, finalColor);

		return {
			analysis,
			parsedPgn: parsed.pgn,
			headers: parsed.headers,
			playerColor: finalColor,
			repertoireId: bestRep.id,
			repertoireName: bestRep.name
		};
	}
};
