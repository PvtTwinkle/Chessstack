import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { connectingEdges, type Edge } from './connect';
import { fenKey, STARTING_FEN } from '$lib/fen';

/** One edge per SAN, replayed from the start position. */
function line(...sans: string[]): Edge[] {
	const chess = new Chess();
	return sans.map((san) => {
		const fromFen = fenKey(chess.fen());
		chess.move(san);
		return { fromFen, toFen: fenKey(chess.fen()), san };
	});
}

const whiteToMove = (fen: string) => fen.split(' ')[1] === 'w';
const sans = (edges: Edge[]) => edges.map((e) => e.san).sort();

describe('connectingEdges', () => {
	it('adds nothing when the chosen moves already connect', () => {
		const chosen = line('e4', 'e5', 'Nf3');
		expect(connectingEdges(STARTING_FEN, chosen, [], line('e4', 'e5'), whiteToMove)).toEqual([]);
	});

	it('links a prep move played after repertoire and game moves', () => {
		// The prep only saved 2.Nf3; 1.e4 came from a repertoire, 1...e5 from a game.
		const [e4, e5, nf3] = line('e4', 'e5', 'Nf3');
		expect(sans(connectingEdges(STARTING_FEN, [nf3], [], [e4, e5], whiteToMove))).toEqual([
			'e4',
			'e5'
		]);
	});

	it('goes through moves the target already has without adding them', () => {
		const [e4, e5, nf3] = line('e4', 'e5', 'Nf3');
		expect(sans(connectingEdges(STARTING_FEN, [nf3], [e4], [e4, e5], whiteToMove))).toEqual(['e5']);
	});

	it("never adds a second user move where there's one already", () => {
		// The target plays 1.d4; the only way to the prep move is via 1.e4.
		const [e4, e5, nf3] = line('e4', 'e5', 'Nf3');
		const [d4] = line('d4');
		expect(connectingEdges(STARTING_FEN, [nf3], [d4], [e4, e5], whiteToMove)).toEqual([]);
	});

	it('leaves a move nothing reaches as it is', () => {
		const [, , nf3] = line('e4', 'e5', 'Nf3');
		expect(connectingEdges(STARTING_FEN, [nf3], [], [], whiteToMove)).toEqual([]);
	});

	it('does not link two lines through two different user moves at one position', () => {
		const [e4, e5, nf3] = line('e4', 'e5', 'Nf3');
		const [d4, d5, c4] = line('d4', 'd5', 'c4');
		const added = connectingEdges(STARTING_FEN, [nf3, c4], [], [e4, e5, d4, d5], whiteToMove);
		const firstMoves = added.filter((e) => e.fromFen === fenKey(STARTING_FEN));
		expect(firstMoves).toHaveLength(1);
	});
});
