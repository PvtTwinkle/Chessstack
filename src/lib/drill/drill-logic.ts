// Pure Drill-mode logic: depth sections, line enumeration and line ordering,
// and the end-of-session "next session" label.

import { fenKey, STARTING_FEN } from '$lib/fen';
import type { DrillSection, DueCard, LineStep, RepertoireMove } from './types';

/**
 * Human-readable label for when the next card is due, for the end screen:
 * "Today at 2:30 PM", "Tomorrow at 9:00 AM" or "In 3 days".
 */
export function formatNextSession(isoStr: string, now: Date = new Date()): string {
	const due = new Date(isoStr);

	// Strip time components to compare calendar days only.
	const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const diffDays = Math.round((dueDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

	const timeStr = due.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

	if (diffDays === 0) return `Today at ${timeStr}`;
	if (diffDays === 1) return `Tomorrow at ${timeStr}`;
	return `In ${diffDays} days`;
}

/** The full-move number from a FEN's 6th field (1 when the field is missing). */
export function getMoveNumber(fen: string): number {
	return parseInt(fen.split(' ')[5], 10) || 1;
}

/**
 * Plies from the starting position to every position in the repertoire, keyed by
 * fenKey. Breadth-first, so transpositions get their shortest path.
 *
 * Needed because stored FENs are normalised to four fields (no move counters),
 * so the move number cannot be read from the FEN itself.
 */
export function computePlyDepths(moves: RepertoireMove[]): Map<string, number> {
	const adj = new Map<string, string[]>();
	for (const m of moves) {
		const from = fenKey(m.fromFen);
		const list = adj.get(from);
		if (list) list.push(fenKey(m.toFen));
		else adj.set(from, [fenKey(m.toFen)]);
	}

	const start = fenKey(STARTING_FEN);
	const depths = new Map<string, number>([[start, 0]]);
	const queue = [start];
	for (let i = 0; i < queue.length; i++) {
		const fen = queue[i];
		const depth = depths.get(fen)!;
		for (const next of adj.get(fen) ?? []) {
			if (!depths.has(next)) {
				depths.set(next, depth + 1);
				queue.push(next);
			}
		}
	}
	return depths;
}

/** Depth section for a full-move number: moves 1–5, 6–15, or 16 and later. */
export function sectionForMoveNumber(move: number): DrillSection {
	if (move <= 5) return 'foundations';
	if (move <= 15) return 'mainlines';
	return 'deep';
}

/**
 * Depth section of the move played from `fen`. With `depths` (from
 * computePlyDepths) the move number comes from the position's depth in the
 * repertoire; otherwise, or for unreachable positions, from the FEN itself.
 */
export function getSection(fen: string, depths?: ReadonlyMap<string, number>): DrillSection {
	const plies = depths?.get(fenKey(fen));
	const move = plies !== undefined ? Math.floor(plies / 2) + 1 : getMoveNumber(fen);
	return sectionForMoveNumber(move);
}

/** Lines are capped so a huge repertoire cannot stall the page. */
export const MAX_LINES = 500;

/**
 * All root-to-leaf lines through the repertoire's move tree. A leaf is a position
 * with no outgoing moves; lines without any of the user's moves are skipped.
 * Transposition cycles are cut, and at most MAX_LINES lines are returned.
 */
export function enumerateLines(moves: RepertoireMove[], color: 'WHITE' | 'BLACK'): LineStep[][] {
	const adj = new Map<string, RepertoireMove[]>();
	for (const m of moves) {
		const key = fenKey(m.fromFen);
		const list = adj.get(key);
		if (list) list.push(m);
		else adj.set(key, [m]);
	}

	const lines: LineStep[][] = [];

	function isUserTurn(fen: string): boolean {
		const sideToMove = fen.split(' ')[1]; // 'w' or 'b'
		return (color === 'WHITE' && sideToMove === 'w') || (color === 'BLACK' && sideToMove === 'b');
	}

	function dfs(fen: string, path: LineStep[], visited: Set<string>): void {
		if (lines.length >= MAX_LINES) return;

		const children = adj.get(fenKey(fen)) ?? [];
		if (children.length === 0) {
			// Leaf — only record if path has at least one user move.
			if (path.some((s) => s.isUserMove)) {
				lines.push([...path]);
			}
			return;
		}

		for (const child of children) {
			const toKey = fenKey(child.toFen);
			if (visited.has(toKey)) continue; // cycle protection

			visited.add(toKey);
			path.push({
				fromFen: child.fromFen,
				toFen: child.toFen,
				san: child.san,
				isUserMove: isUserTurn(child.fromFen)
			});
			dfs(child.toFen, path, visited);
			path.pop();
			visited.delete(toKey);
		}
	}

	const visited = new Set<string>([fenKey(STARTING_FEN)]);
	dfs(STARTING_FEN, [], visited);
	return lines;
}

/**
 * Urgency score of a line: +3 for each of the user's moves that is a due card.
 *
 * NOTE: there is also a +1 branch for lapsed (previously forgotten) cards, but
 * it can never fire: both lookups are built from the same list of *due* cards,
 * so every card it could match already scored +3. Making it work needs the
 * page to receive non-due cards too.
 */
export function scoreLine(line: LineStep[], dueCards: DueCard[]): number {
	const dueSet = new Set(dueCards.map((c) => fenKey(c.fromFen) + ':' + c.san));
	const cardMap = new Map<string, DueCard>();
	for (const c of dueCards) {
		cardMap.set(fenKey(c.fromFen) + ':' + c.san, c);
	}

	let score = 0;
	for (const step of line) {
		if (!step.isUserMove) continue;
		const key = fenKey(step.fromFen) + ':' + step.san;
		if (dueSet.has(key)) {
			score += 3;
		} else {
			const card = cardMap.get(key);
			if (card && (card.lapses ?? 0) > 0) score += 1;
		}
	}
	return score;
}

/** Lines ordered most urgent first; ties are shuffled with `random`. */
export function sortLinesByWeakness(
	lines: LineStep[][],
	dueCards: DueCard[],
	random: () => number = Math.random
): LineStep[][] {
	const scored = lines.map((line) => ({
		line,
		score: scoreLine(line, dueCards),
		rand: random()
	}));
	scored.sort((a, b) => b.score - a.score || a.rand - b.rand);
	return scored.map((s) => s.line);
}
