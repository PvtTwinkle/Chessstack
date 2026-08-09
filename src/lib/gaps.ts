// Gap Finder — shared logic for detecting uncovered positions.
//
// A "gap" is an opponent-turn position in the user's repertoire where a
// move popular among Lichess players near the user's own rating exists but
// the user has no prepared response to it. For example, if the user plays
// 1.e4 and players in their rating window reply with 1...c5, 1...e5, and
// 1...e6, but the user only has lines after 1...e5, then 1...c5 and
// 1...e6 are gaps. `bookMoveSan` / `bookMoves` below keep their original
// names for API stability, but the candidate moves come from the players
// database (lichess_moves), not an opening book.

import { fenKey, STARTING_FEN } from '$lib/fen';
import { lichessMoves } from '$lib/db/schema';
import { and, inArray } from 'drizzle-orm';
import { getEffectiveStartFens } from '$lib/repertoire';
import { gapRatingWindow } from '$lib/ratings';
import type { db } from '$lib/db';
export { fenKey, STARTING_FEN };

/** A single gap: a player-DB move the user hasn't prepared a response to. */
export interface Gap {
	fromFen: string; // opponent-turn position where the move starts
	bookMoveSan: string; // the candidate move with no user response
	toFen: string; // position after that move (user needs a move here)
	line: string; // comma-separated SAN list for ?line= deep link to Build Mode
	depth: number; // number of half-moves to reach toFen (for ranking)
	gamesPlayed?: number; // games played within the rating window (undefined only if moves.length === 0)
	popularityPct?: number; // % of games at this position where this move was played
}

/** Minimal move shape — works with userMove and the aggregated lichessMoves rows. */
interface MoveRow {
	fromFen: string;
	toFen: string;
	san: string;
	gamesPlayed?: number;
	popularityPct?: number;
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
	if (moves.length === 0) return [];

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

	// Build the set of in-scope positions: only check gaps at positions
	// reachable from the effective start FEN(s).
	const effectiveStarts = startFens ?? [STARTING_FEN];
	const inScopeKeys = new Set<string>();
	const scopeQueue: string[] = [];

	for (const fen of effectiveStarts) {
		const key = fenKey(fen);
		if (!inScopeKeys.has(key)) {
			inScopeKeys.add(key);
			scopeQueue.push(key);
		}
	}

	while (scopeQueue.length > 0) {
		const current = scopeQueue.shift()!;
		const children = adj.get(current);
		if (!children) continue;

		for (const child of children) {
			const childKey = fenKey(child.toFen);
			if (inScopeKeys.has(childKey)) continue;
			inScopeKeys.add(childKey);
			scopeQueue.push(childKey);
		}
	}

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
			gamesPlayed: bm.gamesPlayed,
			popularityPct: bm.popularityPct
		});
	}

	// Sort by popularity (descending) first, falling back to depth for any
	// gap that somehow lacks a popularity figure.
	gaps.sort((a, b) => {
		if (a.popularityPct !== undefined && b.popularityPct !== undefined) {
			return b.popularityPct - a.popularityPct;
		}
		if (a.popularityPct !== undefined) return -1;
		if (b.popularityPct !== undefined) return 1;
		return a.depth - b.depth;
	});

	return gaps;
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
 * Walks the full user move tree from the starting position and returns the
 * normalized (4-field) FEN key of every position reached — both user-turn
 * and opponent-turn, including leaf positions with no children yet.
 *
 * This is deliberately broader than "positions that already have a move
 * starting from them": a leaf just created by answering a gap (i.e. the
 * opponent-turn position right after the user's new reply) has no children
 * yet, but it must still be in scope so the next Gap Finder run can query
 * candidate moves for it. Restricting the scope to existing fromFens (the
 * previous approach) silently excluded exactly these freshly-reached
 * positions, so gaps only ever surfaced one ply at a time.
 */
function reachablePositionKeys(moves: MoveRow[]): Set<string> {
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
	const visited = new Set<string>([rootKey]);
	const queue: string[] = [rootKey];
	while (queue.length > 0) {
		const current = queue.shift()!;
		const children = adj.get(current);
		if (!children) continue;
		for (const child of children) {
			const childKey = fenKey(child.toFen);
			if (visited.has(childKey)) continue;
			visited.add(childKey);
			queue.push(childKey);
		}
	}
	return visited;
}

/**
 * Loads gap data for a repertoire by querying the Lichess player-games
 * database (lichess_moves) over a rating window centered on the user's
 * trainer rating, then running computeGaps. This is the shared pipeline
 * used by both the dashboard page and the /api/gaps endpoint.
 *
 * Popularity is computed per opponent-turn position: for each candidate
 * move, gamesPlayed is its own count within the rating window, and
 * popularityPct is that count divided by the total games played from that
 * position within the same window. A move must clear both a minimum game
 * count (minGames — a sample-size floor, since a move can hit 100% of a
 * two-game sample) and a minimum popularity percentage (minPopularityPct)
 * to be reported as a gap.
 *
 * There is no book-table fallback. A position with no qualifying player
 * data in the rating window simply produces no gap there — the intent is
 * to flag what real opponents near your rating actually play, not
 * unweighted opening theory a 1300 is unlikely to face.
 *
 * @param database          Drizzle db instance
 * @param moves             All userMove rows for the repertoire
 * @param repColor          "WHITE" or "BLACK"
 * @param startFen          Custom start FEN or null for default
 * @param minGames          Minimum games played (within the rating window) for gap inclusion
 * @param minPopularityPct  Minimum % of games at the position for gap inclusion
 * @param trainerRating     User's trainer-mode ELO rating, or null if not set yet
 */
export async function loadGapData(
	database: typeof db,
	moves: MoveRow[],
	repColor: 'WHITE' | 'BLACK',
	startFen: string | null,
	minGames: number,
	minPopularityPct: number,
	trainerRating: number | null
): Promise<Gap[]> {
	if (moves.length === 0) return [];

	const opponentTurnChar = repColor === 'WHITE' ? 'b' : 'w';
	const reachableKeys = reachablePositionKeys(moves);
	const opponentFenKeys = [...reachableKeys].filter(
		(key) => key.split(' ')[1] === opponentTurnChar
	);

	const { brackets } = gapRatingWindow(trainerRating);

	const rawMoves =
		opponentFenKeys.length > 0
			? await database
					.select()
					.from(lichessMoves)
					.where(
						and(
							inArray(lichessMoves.positionFen, opponentFenKeys),
							inArray(lichessMoves.ratingBracket, brackets)
						)
					)
			: [];

	// Aggregate across the bracket window: sum games played per (position,
	// move) so a move that appears in more than one bracket in the window
	// is counted once, then compute each position's total for the
	// percentage denominator.
	const byPositionAndMove = new Map<
		string,
		{ fromFen: string; toFen: string; san: string; gamesPlayed: number }
	>();
	const totalByPosition = new Map<string, number>();

	for (const row of rawMoves) {
		const moveKey = `${row.positionFen}\u0000${row.moveSan}`;
		const existing = byPositionAndMove.get(moveKey);
		if (existing) {
			existing.gamesPlayed += row.gamesPlayed;
		} else {
			byPositionAndMove.set(moveKey, {
				fromFen: row.positionFen,
				toFen: row.resultingFen,
				san: row.moveSan,
				gamesPlayed: row.gamesPlayed
			});
		}
		totalByPosition.set(
			row.positionFen,
			(totalByPosition.get(row.positionFen) ?? 0) + row.gamesPlayed
		);
	}

	const candidateMoves: MoveRow[] = [];
	for (const move of byPositionAndMove.values()) {
		const total = totalByPosition.get(move.fromFen) ?? 0;
		const popularityPct = total > 0 ? (move.gamesPlayed / total) * 100 : 0;
		if (move.gamesPlayed < minGames) continue;
		if (popularityPct < minPopularityPct) continue;
		candidateMoves.push({ ...move, popularityPct });
	}

	const startFens = getEffectiveStartFens(startFen, moves, repColor);
	return computeGaps(moves, candidateMoves, repColor, startFens);
}
