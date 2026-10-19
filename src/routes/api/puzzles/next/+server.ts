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
// have been attempted, returns a previously-attempted one. Families are
// prefixes: "sicilian defense" also matches its variations.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { pickPuzzle } from '$lib/server/puzzles';
import { RATE_LIMITS } from '$lib/auth/rate-limit-config';
import { requireAuth, rateLimitResponse } from '$lib/server/api-helpers';

export const GET: RequestHandler = async ({ url, locals }) => {
	const user = requireAuth(locals);

	const limited = await rateLimitResponse(user.id, RATE_LIMITS.puzzlesNext);
	if (limited) return limited;

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

	const toInt = (v: string | null) => {
		const n = v ? parseInt(v) : NaN;
		return isNaN(n) ? undefined : n;
	};
	const result = await pickPuzzle(userId, {
		families,
		minRating: toInt(minRating),
		maxRating: toInt(maxRating),
		// Theme names are camelCase identifiers (e.g. "mateIn2"); pickPuzzle
		// drops anything else, so nothing reaches the regex unescaped.
		themes: themesParam?.split(',').filter((t) => t.length > 0),
		color: colorParam === 'WHITE' || colorParam === 'BLACK' ? colorParam : undefined
	});

	if (!result) {
		return json(null);
	}

	return json(result);
};
