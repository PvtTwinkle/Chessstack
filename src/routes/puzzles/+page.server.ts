// Puzzle page server load function.
//
// 1. Checks the puzzle table has been seeded
// 2. Fetches the active repertoire's moves
// 3. Looks up ECO names for positions in the repertoire
// 4. Resolves them to the puzzle opening families (src/lib/server/puzzles.ts)
// 5. Returns filter metadata so the client can request puzzles

import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { db } from '$lib/db';
import { userMove, ecoOpening } from '$lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { normalizeOpening, getDeepestEcoNames, resolvePuzzleFamilies } from '$lib/puzzleMatching';
import { familiesMatching, puzzleFamilyCounts, themesForFamilies } from '$lib/server/puzzles';
import { fenKey, STARTING_FEN } from '$lib/fen';

export const load: PageServerLoad = async ({ locals, parent }) => {
	const { activeRepertoireId, repertoires } = await parent();

	if (!locals.user) {
		redirect(302, '/login');
	}

	// Empty while the seed is still loading.
	const familyCounts = await puzzleFamilyCounts();
	const hasImportedPuzzles = familyCounts.size > 0;

	if (!hasImportedPuzzles) {
		return {
			hasImportedPuzzles: false,
			openingFamilies: [] as string[],
			totalMatchingPuzzles: 0,
			availableThemes: [] as string[],
			repertoireColor: null as string | null
		};
	}

	if (!activeRepertoireId) {
		return {
			hasImportedPuzzles: true,
			openingFamilies: [] as string[],
			totalMatchingPuzzles: 0,
			availableThemes: [] as string[],
			repertoireColor: null as string | null
		};
	}

	const activeRep = repertoires.find((r) => r.id === activeRepertoireId);
	if (!activeRep) {
		return {
			hasImportedPuzzles: true,
			openingFamilies: [] as string[],
			totalMatchingPuzzles: 0,
			availableThemes: [] as string[],
			repertoireColor: null as string | null
		};
	}

	const userId = locals.user.id;

	// Get all moves from the user's active repertoire (need both fromFen
	// and toFen to build the tree for tree-aware ECO selection).
	const moves = await db
		.select({ fromFen: userMove.fromFen, toFen: userMove.toFen })
		.from(userMove)
		.where(and(eq(userMove.userId, userId), eq(userMove.repertoireId, activeRepertoireId)));

	if (moves.length === 0) {
		return {
			hasImportedPuzzles: true,
			openingFamilies: [] as string[],
			totalMatchingPuzzles: 0,
			availableThemes: [] as string[],
			repertoireColor: activeRep.color
		};
	}

	// Look up ECO names for all positions in the repertoire.
	const allFens = [...new Set([...moves.map((m) => m.fromFen), ...moves.map((m) => m.toFen)])];
	const ecoRows = await db
		.select({ fen: ecoOpening.fen, name: ecoOpening.name })
		.from(ecoOpening)
		.where(inArray(ecoOpening.fen, allFens));

	const ecoByFen = new Map<string, string>();
	for (const row of ecoRows) {
		ecoByFen.set(fenKey(row.fen), row.name);
	}

	// Tree-aware ECO selection: DFS the repertoire tree and collect only
	// the deepest ECO name along each branch. Transit positions (e.g.
	// "King's Knight Opening" on the way to "Scotch Game") are overridden
	// by the deeper opening and excluded from puzzle matching.
	const rootFen = activeRep.startFen ?? STARTING_FEN;
	const deepestNames = getDeepestEcoNames(moves, ecoByFen, rootFen);

	// Normalize for matching against puzzle opening_family column.
	const normalizedDeepest = [...new Set([...deepestNames].map(normalizeOpening))];

	if (normalizedDeepest.length === 0) {
		return {
			hasImportedPuzzles: true,
			openingFamilies: [] as string[],
			totalMatchingPuzzles: 0,
			availableThemes: [] as string[],
			repertoireColor: activeRep.color
		};
	}

	// Families come from the cached per-family counts, so the page reads the
	// puzzle table only for the theme list. Each family stands for its
	// sub-variations too (a prefix match), but not its siblings.
	const resolvedNames = resolvePuzzleFamilies(normalizedDeepest, familyCounts);

	if (resolvedNames.length === 0) {
		return {
			hasImportedPuzzles: true,
			openingFamilies: [] as string[],
			totalMatchingPuzzles: 0,
			availableThemes: [] as string[],
			repertoireColor: activeRep.color
		};
	}

	const openingFamilies = familiesMatching(familyCounts, resolvedNames);
	const totalMatchingPuzzles = openingFamilies.reduce(
		(sum, f) => sum + (familyCounts.get(f) ?? 0),
		0
	);
	const availableThemes = await themesForFamilies(openingFamilies);

	return {
		hasImportedPuzzles: true,
		openingFamilies,
		totalMatchingPuzzles,
		availableThemes,
		repertoireColor: activeRep.color
	};
};
