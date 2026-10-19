// Puzzle opening name matching.
//
// Maps ECO opening names from the user's repertoire to Lichess puzzle
// opening tags. Both use essentially the same opening names, but with
// different formatting:
//
//   ECO:     "Sicilian Defense, Najdorf Variation"
//   Lichess: "Sicilian_Defense_Najdorf_Variation"
//
// The normalizeOpening() function strips formatting differences so both
// produce: "sicilian defense najdorf variation".
//
// The puzzle table's opening_family column was normalised the same way when
// the puzzle dump (seeded on first boot, see src/lib/db/seed-data.ts) was
// built. The script that built it is no longer in this repository, so a
// change here has to match the values already in that dump.

import { fenKey } from '$lib/fen';

/**
 * Normalize an opening name for matching between ECO names and
 * Lichess puzzle opening tags.
 *
 * Strips underscores, commas, colons, apostrophes, lowercases, and
 * collapses whitespace.
 */
export function normalizeOpening(name: string): string {
	let s = name.replace(/_/g, ' ');
	s = s.replace(/[,:'":]/g, '');
	return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Remove broad parent names when a more specific child exists.
 *
 * Given ["scotch game", "scotch game scotch gambit", "sicilian defense",
 * "sicilian defense alapin variation"], returns only the specific ones:
 * ["scotch game scotch gambit", "sicilian defense alapin variation"].
 *
 * A name is considered a parent if another name in the set starts with
 * it followed by a space (ensuring word-boundary matching, not just
 * substring). This prevents "scotch game" from matching all Scotch
 * variations when the user only plays the Scotch Gambit.
 */
export function removeParentNames(names: string[]): string[] {
	// Sort shortest first so parents come before children.
	const sorted = [...names].sort((a, b) => a.length - b.length);
	const result: string[] = [];

	for (const name of sorted) {
		// Check if any longer name in the set starts with this name + space.
		const isParent = sorted.some(
			(other) => other.length > name.length && other.startsWith(name + ' ')
		);
		if (!isParent) {
			result.push(name);
		}
	}

	return result;
}

/**
 * Traverse the repertoire move tree via DFS and collect only the deepest
 * ECO name along each branch. Transit positions (e.g. "King's Knight
 * Opening" on the way to "Scotch Game") are naturally overridden by
 * deeper ECO names and never appear in the result.
 *
 * @param moves     All user moves for the repertoire (fromFen + toFen)
 * @param ecoByFen  Map from fenKey → ECO opening name
 * @param rootFen   The root position of the repertoire tree
 * @returns         Set of deepest ECO names (one per leaf path)
 */
export function getDeepestEcoNames(
	moves: { fromFen: string; toFen: string }[],
	ecoByFen: Map<string, string>,
	rootFen: string
): Set<string> {
	// Build adjacency: fenKey(fromFen) → fenKey(toFen)[]
	const adj = new Map<string, string[]>();
	for (const m of moves) {
		const fk = fenKey(m.fromFen);
		const tk = fenKey(m.toFen);
		let children = adj.get(fk);
		if (!children) {
			children = [];
			adj.set(fk, children);
		}
		if (!children.includes(tk)) children.push(tk);
	}

	const result = new Set<string>();
	const visited = new Set<string>();

	function dfs(fk: string, currentEco: string | null): void {
		if (visited.has(fk)) {
			// Transposition cycle — treat as leaf for this path
			if (currentEco) result.add(currentEco);
			return;
		}
		visited.add(fk);

		// If this position has an ECO name, it overrides the ancestor's
		const eco = ecoByFen.get(fk);
		const effectiveEco = eco ?? currentEco;

		const children = adj.get(fk);
		if (!children || children.length === 0) {
			// Leaf — record the deepest ECO seen along this path
			if (effectiveEco) result.add(effectiveEco);
		} else {
			for (const child of children) {
				dfs(child, effectiveEco);
			}
		}
	}

	dfs(fenKey(rootFen), null);
	return result;
}

/**
 * The puzzle families to use for a repertoire's deepest opening names.
 *
 * A deepest name can be more specific than any puzzle family (e.g. "scotch
 * game classical variation intermezzo variation"), so each one is cut back a
 * word at a time until it names a known family. Parents of another result
 * are then dropped, as in removeParentNames().
 */
export function resolvePuzzleFamilies(
	normalizedNames: Iterable<string>,
	knownFamilies: { has(family: string): boolean }
): string[] {
	const resolved = new Set<string>();
	for (const name of normalizedNames) {
		let candidate = name;
		while (!knownFamilies.has(candidate) && candidate.includes(' ')) {
			candidate = candidate.substring(0, candidate.lastIndexOf(' '));
		}
		if (knownFamilies.has(candidate)) resolved.add(candidate);
	}
	return removeParentNames([...resolved]);
}
