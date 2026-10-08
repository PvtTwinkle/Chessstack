// Gap Finder — shared logic for detecting uncovered positions.
//
// A "gap" is an opponent-turn position in the user's repertoire where
// a book move exists but the user has no prepared response to it.
// For example, if the user plays 1.e4 and the book has 1...c5, 1...e5,
// and 1...e6 as responses, but the user only has lines after 1...e5,
// then 1...c5 and 1...e6 are gaps.

import { Chess } from 'chess.js';
import { fenKey, toFullFen, STARTING_FEN } from '$lib/fen';
import { bookMove, chessmontMoves, ecoOpening } from '$lib/db/schema';
import { and, inArray, gte, desc } from 'drizzle-orm';
import { getEffectiveStartFens, buildInScopeFens } from '$lib/repertoire';
import { sectionForMoveNumber } from '$lib/drill/drill-logic';
import type { DrillSection } from '$lib/drill/types';
import type { db } from '$lib/db';
export { fenKey, STARTING_FEN };

/** A single gap: a book/masters move the user hasn't prepared a response to. */
export interface Gap {
	fromFen: string; // opponent-turn position where the book move starts
	bookMoveSan: string; // the book move with no user response
	toFen: string; // position after that book move (user needs a move here)
	line: string; // comma-separated SAN list for ?line= deep link to Build Mode
	depth: number; // number of half-moves to reach toFen (for ranking)
	gamesPlayed?: number; // masters DB game count (undefined for book-only gaps)
	opening?: { code: string; name: string }; // deepest named ECO opening along the line
}

/** Minimal move shape — works with userMove, bookMove, and chessmontMoves row types. */
interface MoveRow {
	fromFen: string;
	toFen: string;
	san: string;
	gamesPlayed?: number;
}

/**
 * Detects gaps in a user's repertoire by comparing their move tree against
 * the opening book.
 *
 * @param moves      All userMove rows for the repertoire
 * @param bookMoves  Book moves from opponent-turn positions in the repertoire
 * @param color      Which side the user plays ("WHITE" or "BLACK")
 * @param startFens  Optional start FENs — only positions reachable from these
 *                   are checked for gaps. Defaults to [STARTING_FEN].
 * @returns          Sorted array of Gap objects (shallowest first)
 */
export function computeGaps(
	moves: MoveRow[],
	bookMoves: MoveRow[],
	color: 'WHITE' | 'BLACK',
	startFens?: string[]
): Gap[] {
	// Build the user-turn "covered" set — positions where the user has a move.
	// A position is covered if any userMove starts from it on the user's turn.
	const userTurnChar = color === 'WHITE' ? 'w' : 'b';
	const coveredKeys = new Set<string>();
	for (const m of moves) {
		const turn = m.fromFen.split(' ')[1];
		if (turn === userTurnChar) {
			coveredKeys.add(fenKey(m.fromFen));
		}
	}

	// BFS over user moves from the starting position to reconstruct the SAN
	// path to each position. This gives us the ?line= parameter for Build Mode.
	const adj = new Map<string, MoveRow[]>();
	for (const m of moves) {
		const key = fenKey(m.fromFen);
		let list = adj.get(key);
		if (!list) {
			list = [];
			adj.set(key, list);
		}
		list.push(m);
	}

	const rootKey = fenKey(STARTING_FEN);
	const pathMap = new Map<string, string[]>(); // fenKey → SAN path to reach it
	pathMap.set(rootKey, []);

	const queue: string[] = [rootKey];
	while (queue.length > 0) {
		const current = queue.shift()!;
		const children = adj.get(current);
		if (!children) continue;

		const currentPath = pathMap.get(current)!;
		for (const child of children) {
			const childKey = fenKey(child.toFen);
			if (pathMap.has(childKey)) continue; // already visited
			pathMap.set(childKey, [...currentPath, child.san]);
			queue.push(childKey);
		}
	}

	// Only check gaps at positions reachable from the effective start FEN(s).
	const inScopeKeys = buildInScopeFens(startFens ?? [STARTING_FEN], moves);

	// Find gaps: book moves whose destination is not covered by any user move.
	// Only consider book moves from in-scope positions.
	// Deduplicate by toFen key to avoid counting the same uncovered position
	// multiple times (e.g. reached via transposition).
	const seen = new Set<string>();
	const gaps: Gap[] = [];

	for (const bm of bookMoves) {
		const fromKey = fenKey(bm.fromFen);
		if (!inScopeKeys.has(fromKey)) continue; // outside repertoire scope

		const toKey = fenKey(bm.toFen);
		if (coveredKeys.has(toKey)) continue; // user has a response here
		if (seen.has(toKey)) continue; // already recorded this gap
		seen.add(toKey);

		const pathToFrom = pathMap.get(fromKey);
		if (!pathToFrom) continue; // unreachable from starting position (shouldn't happen)

		const line = [...pathToFrom, bm.san].join(',');
		gaps.push({
			fromFen: bm.fromFen,
			bookMoveSan: bm.san,
			toFen: bm.toFen,
			line,
			depth: pathToFrom.length + 1,
			gamesPlayed: bm.gamesPlayed
		});
	}

	// Sort masters gaps first (by games played descending), then book-only gaps by depth.
	gaps.sort((a, b) => {
		if (a.gamesPlayed && b.gamesPlayed) return b.gamesPlayed - a.gamesPlayed;
		if (a.gamesPlayed) return -1;
		if (b.gamesPlayed) return 1;
		return a.depth - b.depth;
	});

	return gaps;
}

/**
 * Depth section of the move the user is missing, with the same move ranges as
 * Drill's sections. `depth` counts plies from the starting position, so the
 * missing move is played at move floor(depth / 2) + 1.
 */
export function gapSection(depth: number): DrillSection {
	return sectionForMoveNumber(Math.floor(depth / 2) + 1);
}

/**
 * Formats a comma-separated SAN list into a human-readable move sequence.
 * Example: "e4,c5,Nf3" → "1. e4 c5 2. Nf3"
 */
export function formatLine(line: string): string {
	const sans = line.split(',');
	return sans.map((san, i) => (i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ${san}` : san)).join(' ');
}

/**
 * Loads gap data for a repertoire by querying the masters DB and book table,
 * then running computeGaps. This is the shared pipeline used by both the
 * dashboard page and the /api/gaps endpoint.
 *
 * @param database     Drizzle db instance
 * @param moves        All userMove rows for the repertoire
 * @param repColor     "WHITE" or "BLACK"
 * @param startFen     Custom start FEN or null for default
 * @param minGames     Minimum master game count for gap inclusion
 */
export async function loadGapData(
	database: typeof db,
	moves: MoveRow[],
	repColor: 'WHITE' | 'BLACK',
	startFen: string | null,
	minGames: number
): Promise<Gap[]> {
	// Scan every opponent-turn position in scope, leaves included. Collecting
	// only positions the opponent already has a move from missed the position
	// right after a reply the user just added, so gaps surfaced one ply at a
	// time; it also skipped the starting position of an empty Black repertoire.
	const startFens = getEffectiveStartFens(startFen, moves, repColor);
	const opponentTurnChar = repColor === 'WHITE' ? 'b' : 'w';
	const opponentFenKeys = [...buildInScopeFens(startFens, moves)].filter(
		(key) => key.split(' ')[1] === opponentTurnChar
	);

	if (opponentFenKeys.length === 0) return [];

	// Query masters database first — only moves played >= minGames times.
	const mastersMoves = await database
		.select()
		.from(chessmontMoves)
		.where(
			and(
				inArray(chessmontMoves.positionFen, opponentFenKeys),
				gte(chessmontMoves.gamesPlayed, minGames)
			)
		)
		.orderBy(desc(chessmontMoves.gamesPlayed));

	// Track which positions have masters data so we can fall back to book for the rest.
	const mastersPositions = new Set(mastersMoves.map((m) => m.positionFen));

	// Fall back to book moves for positions without masters data.
	const bookFallbackFens = opponentFenKeys.filter((f) => !mastersPositions.has(f));
	const relevantBookMoves =
		bookFallbackFens.length > 0
			? await database.select().from(bookMove).where(inArray(bookMove.fromFen, bookFallbackFens))
			: [];

	// Map masters rows to the MoveRow shape expected by computeGaps.
	const mastersAsMoveRows = mastersMoves.map((m) => ({
		fromFen: m.positionFen,
		toFen: m.resultingFen,
		san: m.moveSan,
		gamesPlayed: m.gamesPlayed
	}));

	const allOpponentMoves = [...mastersAsMoveRows, ...relevantBookMoves];

	const gaps = computeGaps(moves, allOpponentMoves, repColor, startFens);
	return attachOpeningNames(database, gaps);
}

/**
 * Replays a gap line from the starting position and returns the 4-field FEN
 * key after each move, oldest first. Stops at the first move that doesn't
 * replay, so a bad line yields a shorter history rather than an error.
 */
export function lineFenKeys(line: string): string[] {
	const chess = new Chess(toFullFen(STARTING_FEN));
	const keys: string[] = [];
	for (const san of line.split(',')) {
		if (!san) continue;
		try {
			chess.move(san);
		} catch {
			break;
		}
		keys.push(fenKey(chess.fen()));
	}
	return keys;
}

/**
 * Names each gap after the deepest ECO opening along its line, with one query
 * for the whole list so the dashboard doesn't need a lookup per gap.
 */
async function attachOpeningNames(database: typeof db, gaps: Gap[]): Promise<Gap[]> {
	if (gaps.length === 0) return gaps;

	const histories = gaps.map((g) => lineFenKeys(g.line));
	const allKeys = [...new Set(histories.flat())];
	if (allKeys.length === 0) return gaps;

	const rows = await database
		.select({ fen: ecoOpening.fen, code: ecoOpening.code, name: ecoOpening.name })
		.from(ecoOpening)
		.where(inArray(ecoOpening.fen, allKeys));
	const byFen = new Map(rows.map((r) => [r.fen, { code: r.code, name: r.name }]));

	return gaps.map((gap, i) => {
		const history = histories[i];
		for (let j = history.length - 1; j >= 0; j--) {
			const opening = byFen.get(history[j]);
			if (opening) return { ...gap, opening };
		}
		return gap;
	});
}
