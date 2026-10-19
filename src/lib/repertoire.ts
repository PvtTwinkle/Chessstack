// Repertoire helpers — shared logic for determining the effective start
// position of a repertoire.
//
// A repertoire's "start position" is the FEN where its scope begins.
// Moves before the start are lead-in moves (not drilled, not gap-checked).
//
// When startFen is NULL (default), the effective start is dynamically
// computed as "after the user's first move(s)." This means:
// - WHITE: the positions resulting from the user's first move from STARTING_FEN
// - BLACK: the positions resulting from the user's first response to
//   each of the opponent's first moves
//
// When startFen is set (custom), that single FEN is used.

import { fenKey, STARTING_FEN } from '$lib/fen';

/** Minimal move shape — works with userMove rows. */
interface MoveRow {
	fromFen: string;
	toFen: string;
	san: string;
}

/**
 * Computes the effective start FEN(s) for a repertoire.
 *
 * @param startFen  The repertoire's stored startFen (null = use default)
 * @param moves     All userMove rows for the repertoire
 * @param color     Which side the user plays
 * @returns         Array of FENs marking where the repertoire's scope begins.
 *                  BFS from these FENs covers all "in-scope" positions.
 */
export function getEffectiveStartFens(
	startFen: string | null,
	moves: MoveRow[],
	color: 'WHITE' | 'BLACK'
): string[] {
	// Custom start position — user explicitly set it.
	if (startFen) return [startFen];

	if (moves.length === 0) return [STARTING_FEN];

	const userTurnChar = color === 'WHITE' ? 'w' : 'b';
	const startKey = fenKey(STARTING_FEN);

	if (color === 'WHITE') {
		// WHITE: user's first moves are from STARTING_FEN.
		// Return the toFen of each user move from the starting position.
		const firstMoves = moves.filter(
			(m) => fenKey(m.fromFen) === startKey && m.fromFen.split(' ')[1] === userTurnChar
		);
		if (firstMoves.length === 0) return [STARTING_FEN];
		return firstMoves.map((m) => m.toFen);
	}

	// BLACK: opponent moves first from STARTING_FEN, then the user responds.
	// Step 1: find all opponent moves from STARTING_FEN → their toFens.
	const opponentFirstMoves = moves.filter(
		(m) => fenKey(m.fromFen) === startKey && m.fromFen.split(' ')[1] !== userTurnChar
	);
	if (opponentFirstMoves.length === 0) return [STARTING_FEN];

	// Step 2: from each opponent's toFen, find the user's responses.
	const opponentToKeys = new Set(opponentFirstMoves.map((m) => fenKey(m.toFen)));
	const userFirstResponses = moves.filter(
		(m) => opponentToKeys.has(fenKey(m.fromFen)) && m.fromFen.split(' ')[1] === userTurnChar
	);

	if (userFirstResponses.length === 0) return [STARTING_FEN];
	return userFirstResponses.map((m) => m.toFen);
}

/**
 * Builds the set of FEN keys that are "in scope" for a repertoire —
 * positions reachable from the effective start position(s) via BFS
 * through the user's move tree.
 *
 * @param startFens  The effective start FENs (from getEffectiveStartFens)
 * @param moves      All userMove rows for the repertoire
 * @returns          Set of fenKey strings that are in scope
 */
export function buildInScopeFens(startFens: string[], moves: MoveRow[]): Set<string> {
	// Build adjacency map: fenKey(fromFen) → list of moves.
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

	// BFS from each start FEN.
	const inScope = new Set<string>();
	const queue: string[] = [];

	for (const fen of startFens) {
		const key = fenKey(fen);
		if (!inScope.has(key)) {
			inScope.add(key);
			queue.push(key);
		}
	}

	while (queue.length > 0) {
		const current = queue.shift()!;
		const children = adj.get(current);
		if (!children) continue;

		for (const child of children) {
			const childKey = fenKey(child.toFen);
			if (inScope.has(childKey)) continue;
			inScope.add(childKey);
			queue.push(childKey);
		}
	}

	return inScope;
}

/**
 * Reconstruct the SAN move sequence from the standard starting position to
 * targetFen.
 *
 * Searches forward from the start, so it returns the shortest line when
 * several reach the target (transpositions) and terminates when the moves
 * form a cycle (1.Nf3 Nf6 2.Ng1 Ng8 leads back to the start).
 *
 * Returns [] if the target is the starting position or unreachable.
 */
export function reconstructPath(moves: MoveRow[], targetFen: string): string[] {
	const targetKey = fenKey(targetFen);
	if (targetKey === STARTING_FEN) return [];

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

	// Breadth-first, remembering how each position was first reached.
	const cameFrom = new Map<string, { fromKey: string; san: string }>();
	const queue = [STARTING_FEN];
	const seen = new Set([STARTING_FEN]);

	for (let i = 0; i < queue.length; i++) {
		const current = queue[i];
		if (current === targetKey) break;
		for (const m of adj.get(current) ?? []) {
			const next = fenKey(m.toFen);
			if (seen.has(next)) continue;
			seen.add(next);
			cameFrom.set(next, { fromKey: current, san: m.san });
			queue.push(next);
		}
	}

	if (!cameFrom.has(targetKey)) return [];

	const pathSans: string[] = [];
	for (let key = targetKey; key !== STARTING_FEN;) {
		const step = cameFrom.get(key)!;
		pathSans.unshift(step.san);
		key = step.fromKey;
	}
	return pathSans;
}

/**
 * What deleting `target` removes, mirroring the server's deleteMove: the move
 * itself and every move after it that the start position no longer reaches
 * without it. A position another line transposes into keeps its moves, and
 * the walk never continues out of the position the deleted move starts from.
 *
 * Returns the ids of the removed moves and the positions left without a path
 * from the start.
 */
export function movesRemovedByDelete<T extends MoveRow & { id: number }>(
	moves: T[],
	target: T
): { removed: Set<number>; unreachableFens: Set<string> } {
	const remaining = moves.filter((m) => m.id !== target.id);

	const adj = new Map<string, T[]>();
	for (const m of remaining) {
		const key = fenKey(m.fromFen);
		let list = adj.get(key);
		if (!list) {
			list = [];
			adj.set(key, list);
		}
		list.push(m);
	}

	const reachable = new Set([STARTING_FEN]);
	const queue = [STARTING_FEN];
	for (let i = 0; i < queue.length; i++) {
		for (const m of adj.get(queue[i]) ?? []) {
			const next = fenKey(m.toFen);
			if (reachable.has(next)) continue;
			reachable.add(next);
			queue.push(next);
		}
	}

	const stopKey = fenKey(target.fromFen);
	const removed = new Set([target.id]);
	const unreachableFens = new Set<string>();
	const walked = new Set<string>();
	const walk = [fenKey(target.toFen)];
	for (let i = 0; i < walk.length; i++) {
		const key = walk[i];
		if (walked.has(key) || key === stopKey) continue;
		walked.add(key);
		if (reachable.has(key)) continue;
		unreachableFens.add(key);
		for (const m of adj.get(key) ?? []) {
			removed.add(m.id);
			walk.push(fenKey(m.toFen));
		}
	}

	return { removed, unreachableFens };
}
