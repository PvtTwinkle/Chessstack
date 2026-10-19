// Connecting prep moves to the start position when they're copied into a
// repertoire.
//
// The prep board lets the user walk through moves that aren't prep moves:
// the opponent's games, and their own repertoires' moves (the gap jump does
// this too). A prep move played after such a step has no saved move leading
// to it, so copied on its own it would sit in the repertoire where no line
// reaches it. This works out the fewest extra moves that link each one back
// to the start, taken from what the board walked through.

import { fenKey } from '$lib/fen';

export interface Edge {
	fromFen: string;
	toFen: string;
	san: string;
}

/**
 * Returns the edges from `available` that link every `chosen` edge to
 * `startFen`, through `chosen` and `existing` edges where possible.
 *
 * - `chosen`: the moves being copied.
 * - `existing`: moves the target already has (they connect, but aren't added).
 * - `available`: moves that may be added to connect the rest.
 * - `isUserTurn(fen)`: on the user's turn a position has one move, so an
 *   available user move is never added where a chosen or existing one is.
 *
 * A chosen move that nothing connects stays as it is; it is no worse off.
 */
export function connectingEdges(
	startFen: string,
	chosen: Edge[],
	existing: Edge[],
	available: Edge[],
	isUserTurn: (fen: string) => boolean
): Edge[] {
	const key = (e: Edge) => `${fenKey(e.fromFen)}|${e.san}`;
	const outgoing = new Map<string, { edge: Edge; cost: 0 | 1 }[]>();
	const add = (from: string, edge: Edge, cost: 0 | 1) => {
		if (!outgoing.has(from)) outgoing.set(from, []);
		outgoing.get(from)!.push({ edge, cost });
	};

	const fixedKeys = new Set<string>();
	const userFixedAt = new Set<string>();
	for (const e of [...chosen, ...existing]) {
		const from = fenKey(e.fromFen);
		add(from, e, 0);
		fixedKeys.add(key(e));
		if (isUserTurn(from)) userFixedAt.add(from);
	}
	const seenAvailable = new Set<string>();
	for (const e of available) {
		const from = fenKey(e.fromFen);
		if (fixedKeys.has(key(e)) || seenAvailable.has(key(e))) continue;
		if (isUserTurn(from) && userFixedAt.has(from)) continue;
		seenAvailable.add(key(e));
		add(from, e, 1);
	}

	// 0-1 breadth-first search: moves already there cost nothing and added
	// ones cost one, so each position is reached with the fewest additions.
	// Zero-cost steps go on a stack that is drained before the queue, which
	// is the deque's push-front.
	const start = fenKey(startFen);
	const cost = new Map<string, number>([[start, 0]]);
	// How each position was reached: the position before it and, when the
	// step has to be added, the move.
	const reachedBy = new Map<string, { from: string; added: Edge | null }>();
	const zeroCost: string[] = [start];
	const queue: string[] = [];
	let head = 0;
	while (zeroCost.length > 0 || head < queue.length) {
		const at = zeroCost.length > 0 ? zeroCost.pop()! : queue[head++];
		const atCost = cost.get(at)!;
		for (const { edge, cost: step } of outgoing.get(at) ?? []) {
			const to = fenKey(edge.toFen);
			const next = atCost + step;
			if ((cost.get(to) ?? Infinity) <= next) continue;
			cost.set(to, next);
			reachedBy.set(to, { from: at, added: step === 1 ? edge : null });
			if (step === 0) zeroCost.push(to);
			else queue.push(to);
		}
	}

	const result = new Map<string, Edge>();
	// The user move added at each position, so two chains never add two.
	const userAddedAt = new Map<string, string>();
	for (const e of chosen) {
		let at = fenKey(e.fromFen);
		const chain: Edge[] = [];
		const seen = new Set<string>();
		let connected = true;
		while (at !== start) {
			const step = reachedBy.get(at);
			if (!step || seen.has(at)) {
				connected = false; // Nothing reaches it.
				break;
			}
			seen.add(at);
			if (step.added) chain.push(step.added);
			at = step.from;
		}
		const clashes = chain.some((edge) => {
			const from = fenKey(edge.fromFen);
			const added = userAddedAt.get(from);
			return isUserTurn(from) && added !== undefined && added !== key(edge);
		});
		if (!connected || clashes) continue;
		for (const edge of chain) {
			result.set(key(edge), edge);
			const from = fenKey(edge.fromFen);
			if (isUserTurn(from)) userAddedAt.set(from, key(edge));
		}
	}
	return [...result.values()];
}
