// Puzzle lookups for the Puzzles page and GET /api/puzzles/next.
//
// The puzzle table is read-only seed data of about a million rows, so the
// per-family counts are read once and kept in memory, and the page's family
// list and total come from them without touching the table. Random picks use
// a random starting puzzle_id rather than count(*) plus OFFSET, which reads
// every matching row each time.

import {
	and,
	count,
	eq,
	gte,
	inArray,
	isNotNull,
	lte,
	notExists,
	or,
	sql,
	type SQL
} from 'drizzle-orm';
import { db } from '$lib/db';
import { puzzle, puzzleAttempt } from '$lib/db/schema';

type Puzzle = typeof puzzle.$inferSelect;

/** How long the family counts are kept. The table only changes when it is seeded. */
const FAMILY_CACHE_MS = 60 * 60 * 1000;
/** Theme lists kept per family selection; the oldest goes first. */
const THEME_CACHE_LIMIT = 500;

let familyCache: { at: number; counts: Map<string, number> } | null = null;
let familyLoad: Promise<Map<string, number>> | null = null;
const themeCache = new Map<string, { at: number; themes: string[] }>();

/** Forgets the cached counts and themes (tests, or after seeding). */
export function clearPuzzleCache(): void {
	familyCache = null;
	familyLoad = null;
	themeCache.clear();
}

/**
 * Puzzles per opening family. An empty result isn't cached: the table is
 * empty while the seed is still loading, and the page should notice when it
 * finishes.
 */
export async function puzzleFamilyCounts(): Promise<Map<string, number>> {
	if (familyCache && Date.now() - familyCache.at < FAMILY_CACHE_MS) return familyCache.counts;
	// Requests that arrive while the first one is reading share its query.
	familyLoad ??= (async () => {
		try {
			const rows = await db
				.select({ family: puzzle.openingFamily, n: count() })
				.from(puzzle)
				.groupBy(puzzle.openingFamily);
			const counts = new Map(rows.map((r) => [r.family, r.n]));
			if (counts.size > 0) familyCache = { at: Date.now(), counts };
			return counts;
		} finally {
			familyLoad = null;
		}
	})();
	return familyLoad;
}

/** Every theme tag used by puzzles in these exact families, sorted. */
export async function themesForFamilies(families: string[]): Promise<string[]> {
	if (families.length === 0) return [];
	const key = [...families].sort().join('\n');
	const cached = themeCache.get(key);
	if (cached && Date.now() - cached.at < FAMILY_CACHE_MS) return cached.themes;

	// Exact families, so the opening_family index applies (a prefix LIKE ANY
	// couldn't use it).
	const rows = await db
		.selectDistinct({ theme: sql<string>`unnest(string_to_array(${puzzle.themes}, ' '))` })
		.from(puzzle)
		.where(and(isNotNull(puzzle.themes), inArray(puzzle.openingFamily, families)));
	const themes = rows
		.map((r) => r.theme)
		.filter((t) => t.length > 0)
		.sort();

	themeCache.delete(key);
	themeCache.set(key, { at: Date.now(), themes });
	if (themeCache.size > THEME_CACHE_LIMIT) {
		const oldest = themeCache.keys().next().value;
		if (oldest !== undefined) themeCache.delete(oldest);
	}
	return themes;
}

/** Families that start with any of the prefixes, as `LIKE 'prefix%'` would match. */
export function familiesMatching(counts: Map<string, number>, prefixes: string[]): string[] {
	return [...counts.keys()].filter((f) => prefixes.some((p) => f.startsWith(p))).sort();
}

/** `LIKE` treats %, _ and \ as special; match them literally. */
export function escapeLike(text: string): string {
	return text.replace(/[\\%_]/g, '\\$&');
}

/**
 * opening_family starts with one of the prefixes. Written as separate LIKEs
 * joined by OR rather than LIKE ANY(ARRAY[...]): the planner can serve each
 * one from a text_pattern_ops index, and can't do that for LIKE ANY.
 */
export function familyPrefixCondition(prefixes: string[]): SQL | undefined {
	return or(...prefixes.map((p) => sql`${puzzle.openingFamily} LIKE ${escapeLike(p) + '%'}`));
}

export interface PuzzleFilters {
	families: string[];
	minRating?: number;
	maxRating?: number;
	/** Theme tags; a puzzle matches if it has any of them. Must be \w+ only. */
	themes?: string[];
	/** The user's repertoire colour; only puzzles where the user plays it. */
	color?: 'WHITE' | 'BLACK';
}

const PUZZLE_ID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** A random string shaped like a Lichess puzzle id, used as a starting point. */
function randomPuzzleKey(): string {
	let key = '';
	for (let i = 0; i < 5; i++) {
		key += PUZZLE_ID_ALPHABET[Math.floor(Math.random() * PUZZLE_ID_ALPHABET.length)];
	}
	return key;
}

/**
 * The first matching puzzle at or after a random puzzle_id, wrapping round
 * to the first one. This reads from an index instead of counting every
 * match. It isn't perfectly uniform (a puzzle after a long gap in the ids is
 * picked more often), which doesn't matter for practice.
 */
async function pickRandom(conditions: (SQL | undefined)[]): Promise<Puzzle | undefined> {
	const [row] = await db
		.select()
		.from(puzzle)
		.where(and(...conditions, gte(puzzle.puzzleId, randomPuzzleKey())))
		.orderBy(puzzle.puzzleId)
		.limit(1);
	if (row) return row;
	const [first] = await db
		.select()
		.from(puzzle)
		.where(and(...conditions))
		.orderBy(puzzle.puzzleId)
		.limit(1);
	return first;
}

/**
 * A random puzzle matching the filters, preferring ones the user hasn't
 * tried; once they have tried them all, any match.
 */
export async function pickPuzzle(
	userId: number,
	filters: PuzzleFilters
): Promise<Puzzle | undefined> {
	const conditions: (SQL | undefined)[] = [familyPrefixCondition(filters.families)];
	if (filters.minRating !== undefined) conditions.push(gte(puzzle.rating, filters.minRating));
	if (filters.maxRating !== undefined) conditions.push(lte(puzzle.rating, filters.maxRating));
	// The FEN's side to move plays the setup move, so the user is the other side.
	if (filters.color) {
		const toMove = filters.color === 'WHITE' ? 'b' : 'w';
		conditions.push(sql`split_part(${puzzle.fen}, ' ', 2) = ${toMove}`);
	}
	const themes = (filters.themes ?? []).filter((t) => /^\w+$/.test(t));
	if (themes.length > 0) {
		// Whole words of the space-separated themes column.
		conditions.push(or(...themes.map((t) => sql`${puzzle.themes} ~ ${'\\m' + t + '\\M'}`)));
	}

	const untried = notExists(
		db
			.select({ one: sql`1` })
			.from(puzzleAttempt)
			.where(and(eq(puzzleAttempt.userId, userId), eq(puzzleAttempt.puzzleId, puzzle.puzzleId)))
	);
	return (await pickRandom([...conditions, untried])) ?? (await pickRandom(conditions));
}
