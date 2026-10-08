import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { computeGaps, fenKey, gapSection, lineFenKeys, STARTING_FEN } from './gaps';
import { toFullFen } from './fen';

/** Replays SANs from the start and returns one move row per ply, as user_move stores them. */
function movesFor(...sans: string[]) {
	const chess = new Chess(toFullFen(STARTING_FEN));
	return sans.map((san) => {
		const fromFen = fenKey(chess.fen());
		chess.move(san);
		return { fromFen, toFen: fenKey(chess.fen()), san };
	});
}

describe('computeGaps', () => {
	it("reports White's first moves for an empty Black repertoire", () => {
		const [e4, d4] = [movesFor('e4')[0], movesFor('d4')[0]];
		const gaps = computeGaps([], [e4, d4], 'BLACK');
		expect(gaps.map((g) => g.line)).toEqual(['e4', 'd4']);
	});

	it('reports gaps right after a reply that has no continuation yet', () => {
		const tree = movesFor('e4');
		const [, c5] = movesFor('e4', 'c5');
		const gaps = computeGaps(tree, [c5], 'WHITE', [tree[0].toFen]);
		expect(gaps).toMatchObject([{ line: 'e4,c5', depth: 2 }]);
	});

	it('skips book moves the user already answers', () => {
		const tree = movesFor('e4', 'c5', 'Nf3');
		const gaps = computeGaps(tree, [tree[1]], 'WHITE', [tree[0].toFen]);
		expect(gaps).toEqual([]);
	});

	it('ignores positions before the start of the repertoire', () => {
		const tree = movesFor('e4', 'e5', 'Nf3');
		const [, c5] = movesFor('e4', 'c5');
		// Scope starts after 2.Nf3, so 1...c5 is a lead-in alternative, not a gap.
		expect(computeGaps(tree, [c5], 'WHITE', [tree[2].toFen])).toEqual([]);
	});

	it('ranks masters gaps by games played ahead of book-only gaps', () => {
		const tree = movesFor('e4');
		const [, c5] = movesFor('e4', 'c5');
		const [, e6] = movesFor('e4', 'e6');
		const [, a6] = movesFor('e4', 'a6');
		const gaps = computeGaps(
			tree,
			[a6, { ...e6, gamesPlayed: 10 }, { ...c5, gamesPlayed: 500 }],
			'WHITE',
			[tree[0].toFen]
		);
		expect(gaps.map((g) => g.bookMoveSan)).toEqual(['c5', 'e6', 'a6']);
	});
});

describe('lineFenKeys', () => {
	it('returns the 4-field key after each move', () => {
		const keys = lineFenKeys('e4,c5');
		expect(keys).toHaveLength(2);
		expect(keys[1]).toBe('rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -');
	});

	it('stops at a move that does not replay', () => {
		expect(lineFenKeys('e4,Ke3,e5')).toHaveLength(1);
	});
});

describe('gapSection', () => {
	it('uses the move number of the missing move', () => {
		// 1.e4 c5 (depth 2): the user's missing reply is move 2.
		expect(gapSection(2)).toBe('foundations');
		// 9 plies in, Black's reply is still move 5.
		expect(gapSection(9)).toBe('foundations');
		expect(gapSection(10)).toBe('mainlines');
		expect(gapSection(29)).toBe('mainlines');
		expect(gapSection(30)).toBe('deep');
	});
});
