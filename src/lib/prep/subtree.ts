// Which prep moves go when one is deleted: the move, and every prep move
// after it that no other line on the prep board still reaches. Used by the
// server to delete them and by the page to say how many will go.

import { fenKey } from '$lib/fen';
import type { Edge } from './connect';

export interface PrepMoveEdge extends Edge {
	id: number;
}

/**
 * Ids of `moveId` and the prep moves that only it leads to.
 *
 * - `prepMoves`: the prep's moves for one colour.
 * - `walkable`: the other moves the prep board walks through (the opponent's
 *   games, the user's repertoires of that colour).
 *
 * A prep move nothing reached before the delete is left alone: it wasn't
 * part of this line.
 */
export function prepSubtreeIds(
	startFen: string,
	prepMoves: PrepMoveEdge[],
	walkable: Edge[],
	moveId: number
): number[] {
	const out = new Map<string, { to: string; id: number | null }[]>();
	const add = (from: string, to: string, id: number | null) => {
		if (!out.has(from)) out.set(from, []);
		out.get(from)!.push({ to, id });
	};
	for (const m of prepMoves) add(fenKey(m.fromFen), fenKey(m.toFen), m.id);
	for (const e of walkable) add(fenKey(e.fromFen), fenKey(e.toFen), null);

	const reach = (skipId: number | null): Set<string> => {
		const seen = new Set<string>([fenKey(startFen)]);
		const queue = [fenKey(startFen)];
		for (let head = 0; head < queue.length; head++) {
			for (const { to, id } of out.get(queue[head]) ?? []) {
				if (id !== null && id === skipId) continue;
				if (seen.has(to)) continue;
				seen.add(to);
				queue.push(to);
			}
		}
		return seen;
	};

	const before = reach(null);
	const after = reach(moveId);
	const ids = [moveId];
	for (const m of prepMoves) {
		if (m.id === moveId) continue;
		const from = fenKey(m.fromFen);
		if (before.has(from) && !after.has(from)) ids.push(m.id);
	}
	return ids;
}
