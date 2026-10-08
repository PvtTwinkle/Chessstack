// GET /api/puzzles/next
//
// Returns one random puzzle matching the user's repertoire openings.
// Accepts query parameters for filtering:
//   families  — comma-separated list of normalized opening families
//   minRating — minimum puzzle rating (optional)
//   maxRating — maximum puzzle rating (optional)
//   themes    — comma-separated theme filter (optional, any match)
//
// Prefers puzzles the user hasn't attempted yet. If all matching puzzles
// have been attempted, returns a previously-attempted one.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { puzzle, puzzleAttempt } from '$lib/db/schema';
import { eq, and, sql, gte, lte, notInArray } from 'drizzle-orm';
import { isRateLimited } from '$lib/auth/rate-limit';
import { RATE_LIMITS } from '$lib/auth/rate-limit-config';
import { requireAuth } from '$lib/server/api-helpers';

export const GET: RequestHandler = async ({ url, locals }) => {
	const user = requireAuth(locals);

	if (await isRateLimited(String(user.id), RATE_LIMITS.puzzlesNext)) {
		return json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
	}

	const userId = user.id;

	// Parse filter parameters
	const familiesParam = url.searchParams.get('families');
	if (!familiesParam) {
		throw error(400, 'families parameter is required');
	}
	const families = familiesParam.split(',').filter((f) => f.length > 0);
	if (families.length === 0) {
		throw error(400, 'At least one opening family is required');
	}

	const minRating = url.searchParams.get('minRating');
	const maxRating = url.searchParams.get('maxRating');
	const themesParam = url.searchParams.get('themes');
	const colorParam = url.searchParams.get('color'); // 'WHITE' or 'BLACK'

	// Build the WHERE conditions
	// Prefix-match: each family becomes a LIKE 'family%' clause.
	// Escape SQL LIKE wildcards (% and _) in user input before appending %.
	const likePatterns = families.map((f) => `${f.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`);
	const conditions = [
		sql`${puzzle.openingFamily} LIKE ANY(ARRAY[${sql.join(
			likePatterns.map((p) => sql`${p}`),
			sql`, `
		)}])`
	];

	if (minRating) {
		const min = parseInt(minRating);
		if (!isNaN(min)) conditions.push(gte(puzzle.rating, min));
	}
	if (maxRating) {
		const max = parseInt(maxRating);
		if (!isNaN(max)) conditions.push(lte(puzzle.rating, max));
	}
	// Color filter: the FEN's active color is who plays the setup move (opponent).
	// User plays the opposite side. So WHITE repertoire → FEN turn = 'b', BLACK → 'w'.
	if (colorParam === 'WHITE') {
		conditions.push(sql`split_part(${puzzle.fen}, ' ', 2) = 'b'`);
	} else if (colorParam === 'BLACK') {
		conditions.push(sql`split_part(${puzzle.fen}, ' ', 2) = 'w'`);
	}

	if (themesParam) {
		// Match puzzles that contain ANY of the specified themes.
		// Theme names are camelCase identifiers (e.g. "mateIn2", "fork") — reject
		// anything else to prevent regex metacharacter injection.
		const themes = themesParam.split(',').filter((t) => t.length > 0 && /^\w+$/.test(t));
		if (themes.length > 0) {
			// Each theme must appear as a word in the space-separated themes field
			const themeConditions = themes.map((t) => sql`${puzzle.themes} ~ ${'\\m' + t + '\\M'}`);
			conditions.push(sql`(${sql.join(themeConditions, sql` OR `)})`);
		}
	}

	// Subquery for puzzle IDs the user has already attempted — avoids loading
	// all attempted IDs into memory by letting the database handle the filtering.
	const attemptedSubquery = db
		.select({ puzzleId: puzzleAttempt.puzzleId })
		.from(puzzleAttempt)
		.where(eq(puzzleAttempt.userId, userId));

	// Try to find an unattempted puzzle first.
	// Uses count + random offset instead of ORDER BY RANDOM() to avoid
	// sorting the entire result set — much faster for large puzzle tables.
	const unattemptedConditions = [...conditions, notInArray(puzzle.puzzleId, attemptedSubquery)];

	const [{ count: unattemptedCount }] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(puzzle)
		.where(and(...unattemptedConditions));

	let result;
	if (unattemptedCount > 0) {
		const randomOffset = Math.floor(Math.random() * unattemptedCount);
		[result] = await db
			.select()
			.from(puzzle)
			.where(and(...unattemptedConditions))
			.limit(1)
			.offset(randomOffset);
	}

	// If no unattempted puzzle found, fall back to any matching puzzle.
	if (!result) {
		const [{ count: totalCount }] = await db
			.select({ count: sql<number>`count(*)::int` })
			.from(puzzle)
			.where(and(...conditions));

		if (totalCount > 0) {
			const randomOffset = Math.floor(Math.random() * totalCount);
			[result] = await db
				.select()
				.from(puzzle)
				.where(and(...conditions))
				.limit(1)
				.offset(randomOffset);
		}
	}

	if (!result) {
		return json(null);
	}

	return json(result);
};
