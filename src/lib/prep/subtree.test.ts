import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { prepSubtreeIds, type PrepMoveEdge } from './subtree';
import type { Edge } from './connect';
import { fenKey, STARTING_FEN } from '$lib/fen';

function line(...sans: string[]): Edge[] {
	const chess = new Chess();
	return sans.map((san) => {
		const fromFen = fenKey(chess.fen());
		chess.move(san);
		return { fromFen, toFen: fenKey(chess.fen()), san };
	});
}

const withId = (e: Edge, id: number): PrepMoveEdge => ({ ...e, id });

describe('prepSubtreeIds', () => {
	// White prep: 1.e4 (prep) e5 (game) 2.Nf3 (prep) Nc6 (game) 3.Bb5 (prep).
	const [e4, e5, nf3, nc6, bb5] = line('e4', 'e5', 'Nf3', 'Nc6', 'Bb5');
	const prep = [withId(e4, 1), withId(nf3, 2), withId(bb5, 3)];
	const games = [e5, nc6];

	it('takes the prep moves after the deleted one with it', () => {
		expect(prepSubtreeIds(STARTING_FEN, prep, games, 2).sort()).toEqual([2, 3]);
		expect(prepSubtreeIds(STARTING_FEN, prep, games, 1).sort()).toEqual([1, 2, 3]);
	});

	it('keeps moves that another line still reaches', () => {
		// 1.Nf3 Nc6 2.e4 e5 transposes to the position after 1.e4 e5 2.Nf3 Nc6.
		const [nf3First, nc6First, e4Second, e5Second] = line('Nf3', 'Nc6', 'e4', 'e5');
		const both = [...prep, withId(nf3First, 4), withId(e4Second, 5)];
		const walk = [...games, nc6First, e5Second];
		// Deleting 1.e4 takes 2.Nf3 with it, but 3.Bb5 is still reached via 1.Nf3.
		expect(prepSubtreeIds(STARTING_FEN, both, walk, 1).sort()).toEqual([1, 2]);
	});

	it('leaves alone a prep move that was never reached', () => {
		const [, , , , , island] = line('d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6');
		const withIsland = [...prep, withId(island, 9)];
		expect(prepSubtreeIds(STARTING_FEN, withIsland, games, 1)).not.toContain(9);
	});

	it('walks through repertoire moves as well as games', () => {
		// 1.e4 is in a repertoire, not the prep; deleting 2.Nf3 still takes 3.Bb5.
		const prepOnly = [withId(nf3, 2), withId(bb5, 3)];
		expect(prepSubtreeIds(STARTING_FEN, prepOnly, [e4, ...games], 2).sort()).toEqual([2, 3]);
	});
});
