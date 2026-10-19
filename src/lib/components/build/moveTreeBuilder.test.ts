import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { buildMoveTree } from './moveTreeBuilder';
import type { TreeNode } from './MoveTreeLine.svelte';

// Repertoire moves for each line, in the order they were added.
function movesFor(...lines: string[][]) {
	const moves: { fromFen: string; toFen: string; san: string; createdAt: number }[] = [];
	const seen = new Set<string>();
	for (const line of lines) {
		const chess = new Chess();
		for (const san of line) {
			const fromFen = chess.fen();
			chess.move(san);
			const key = `${fromFen}|${san}`;
			if (seen.has(key)) continue;
			seen.add(key);
			moves.push({ fromFen, toFen: chess.fen(), san, createdAt: moves.length });
		}
	}
	return moves;
}

function follow(roots: TreeNode[], ...sans: string[]): TreeNode {
	let nodes = roots;
	let node: TreeNode | undefined;
	for (const san of sans) {
		node = nodes.find((n) => n.san === san);
		if (!node) throw new Error(`no ${san}`);
		nodes = node.children;
	}
	return node!;
}

describe('buildMoveTree', () => {
	it('flags a move order that transposes into a line shown elsewhere', () => {
		const tree = buildMoveTree(
			movesFor(['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'], ['c4', 'Nf6', 'd4']),
			null
		);
		const main = follow(tree, 'd4', 'Nf6', 'c4');
		expect(main.transposition).toBe(false);
		expect(main.children.map((n) => n.san)).toEqual(['e6']);

		const other = follow(tree, 'c4', 'Nf6', 'd4');
		expect(other.transposition).toBe(true);
		expect(other.children).toEqual([]);
	});

	it('does not flag a transposition into a position with no further moves', () => {
		const tree = buildMoveTree(movesFor(['d4', 'Nf6', 'c4'], ['c4', 'Nf6', 'd4']), null);
		expect(follow(tree, 'c4', 'Nf6', 'd4').transposition).toBe(false);
	});
});
