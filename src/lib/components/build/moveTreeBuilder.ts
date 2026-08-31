/**
 * moveTreeBuilder.ts
 * ──────────────────
 * Pure functions to build a display tree from a flat list of repertoire moves.
 * Reuses the adjacency-map + DFS pattern from exportPgn.ts.
 */

import type { TreeNode } from './MoveTreeLine.svelte';
import { fenKey, STARTING_FEN } from '$lib/fen';

export { fenKey };

interface MoveInput {
	fromFen: string;
	toFen: string;
	san: string;
	createdAt: Date | string | number;
}

interface MoveEdge {
	san: string;
	fromFen: string;
	toFen: string;
	createdAt: number;
}

function buildAdjacencyMap(moves: MoveInput[]): Map<string, MoveEdge[]> {
	const map = new Map<string, MoveEdge[]>();
	for (const m of moves) {
		const key = fenKey(m.fromFen);
		let arr = map.get(key);
		if (!arr) {
			arr = [];
			map.set(key, arr);
		}
		arr.push({
			san: m.san,
			fromFen: m.fromFen,
			toFen: m.toFen,
			createdAt:
				m.createdAt instanceof Date
					? m.createdAt.getTime()
					: typeof m.createdAt === 'number'
						? m.createdAt
						: new Date(m.createdAt).getTime()
		});
	}
	// Sort by createdAt ascending — first-added move = mainline
	for (const arr of map.values()) {
		arr.sort((a, b) => a.createdAt - b.createdAt);
	}
	return map;
}

function buildTreeDFS(
	fen: string,
	adj: Map<string, MoveEdge[]>,
	visited: Set<string>,
	ply: number,
	pathSans: string[]
): TreeNode[] {
	const key = fenKey(fen);
	const edges = adj.get(key);
	if (!edges) return [];

	return edges.map((edge) => {
		const nodePath = [...pathSans, edge.san];
		const childKey = fenKey(edge.toFen);
		const alreadyVisited = visited.has(childKey);

		if (!alreadyVisited) {
			visited.add(childKey);
		}

		return {
			san: edge.san,
			fromFen: edge.fromFen,
			toFen: edge.toFen,
			toFenKey: childKey,
			ply,
			// A transposition: this move leads to a position already reached via a
			// different path elsewhere in the tree. Stop expanding here instead of
			// re-walking the whole subtree again, but flag it so the UI can show
			// this is a convergence point, not a dead end.
			children: alreadyVisited ? [] : buildTreeDFS(edge.toFen, adj, visited, ply + 1, nodePath),
			pathSans: nodePath,
			isTransposition: alreadyVisited,
			transposesToFenKey: alreadyVisited ? childKey : undefined
		};
	});
}

/** BFS from STARTING_FEN to find the SAN path to a given start position. */
function findPathToStart(adj: Map<string, MoveEdge[]>, targetFen: string): string[] {
	const targetKey = fenKey(targetFen);
	const startKey = fenKey(STARTING_FEN);
	if (targetKey === startKey) return [];

	const queue: Array<{ fen: string; path: string[] }> = [{ fen: STARTING_FEN, path: [] }];
	const visited = new Set<string>([startKey]);

	while (queue.length > 0) {
		const { fen, path } = queue.shift()!;
		const edges = adj.get(fenKey(fen));
		if (!edges) continue;

		for (const edge of edges) {
			const edgeKey = fenKey(edge.toFen);
			if (edgeKey === targetKey) return [...path, edge.san];
			if (!visited.has(edgeKey)) {
				visited.add(edgeKey);
				queue.push({ fen: edge.toFen, path: [...path, edge.san] });
			}
		}
	}
	return [];
}

/**
 * Build a display tree from a flat list of repertoire moves.
 *
 * @param moves     All user moves for the repertoire
 * @param startFen  Optional custom start position (tree root)
 * @returns         Array of root-level tree nodes
 */
export function buildMoveTree(moves: MoveInput[], startFen: string | null): TreeNode[] {
	if (moves.length === 0) return [];

	const adj = buildAdjacencyMap(moves);
	const rootFen = startFen ?? STARTING_FEN;
	const prefixPath = startFen ? findPathToStart(adj, startFen) : [];

	// Compute starting ply from the root FEN
	const fenParts = rootFen.split(' ');
	const isWhite = fenParts[1] === 'w';
	const fullmove = parseInt(fenParts[5] ?? '1', 10);
	const startPly = (fullmove - 1) * 2 + (isWhite ? 1 : 2);

	const visited = new Set<string>([fenKey(rootFen)]);
	return buildTreeDFS(rootFen, adj, visited, startPly, prefixPath);
}

/**
 * Build a lookup map from fenKey -> TreeNode (first/mainline occurrence).
 */
export function buildNodeIndex(roots: TreeNode[]): Map<string, TreeNode> {
	const map = new Map<string, TreeNode>();
	function walk(nodes: TreeNode[]) {
		for (const n of nodes) {
			if (!map.has(n.toFenKey)) {
				map.set(n.toFenKey, n);
			}
			walk(n.children);
		}
	}
	walk(roots);
	return map;
}
