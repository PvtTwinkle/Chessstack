import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { fenKey, STARTING_FEN } from '$lib/fen';
import { movesRemovedByDelete, reconstructPath } from './repertoire';

/** One move row per SAN, replayed from `from` (the start position by default). */
function line(sans: string[], from = STARTING_FEN) {
	const chess = new Chess(from);
	return sans.map((san) => {
		const fromFen = fenKey(chess.fen());
		chess.move(san);
		return { fromFen, toFen: fenKey(chess.fen()), san };
	});
}

describe('reconstructPath', () => {
	it('returns the moves from the start to a position', () => {
		const moves = line(['e4', 'e5', 'Nf3']);
		expect(reconstructPath(moves, moves[2].toFen)).toEqual(['e4', 'e5', 'Nf3']);
	});

	it('returns nothing for the start position or a position the moves never reach', () => {
		const moves = line(['e4', 'e5']);
		expect(reconstructPath(moves, STARTING_FEN)).toEqual([]);
		expect(reconstructPath(moves, line(['d4'])[0].toFen)).toEqual([]);
	});

	it('terminates when the moves cycle back to an earlier position', () => {
		// After 3...Ng8 the position (ignoring move counters) is the one after 1...e5,
		// and the last row written into it is the cycle's closing move.
		const moves = line(['e4', 'e5', 'Nf3', 'Nf6', 'Ng1', 'Ng8']);
		expect(moves[5].toFen).toBe(moves[1].toFen);
		expect(reconstructPath(moves, moves[1].toFen)).toEqual(['e4', 'e5']);
		expect(reconstructPath(moves, moves[4].toFen)).toEqual(['e4', 'e5', 'Nf3', 'Nf6', 'Ng1']);
	});

	it('terminates on a cycle through the start position', () => {
		const moves = line(['Nf3', 'Nf6', 'Ng1', 'Ng8', 'e4']);
		expect(reconstructPath(moves, moves[4].toFen)).toEqual(['e4']);
	});

	it('takes the shortest line into a transposition', () => {
		const long = line(['Nf3', 'Nf6', 'c4', 'e6', 'd4']);
		const short = line(['d4', 'Nf6', 'c4', 'e6', 'Nf3']);
		expect(long[4].toFen).toBe(short[4].toFen);
		const path = reconstructPath([...long, ...short], long[4].toFen);
		expect(path).toHaveLength(5);
	});
});

describe('movesRemovedByDelete', () => {
	const withIds = <T>(rows: T[]) => rows.map((m, i) => ({ ...m, id: i + 1 }));
	const sans = (moves: { id: number; san: string }[], ids: Set<number>) =>
		moves.filter((m) => ids.has(m.id)).map((m) => m.san);

	it('removes the move and everything after it', () => {
		const moves = withIds([...line(['e4', 'e5', 'Nf3']), ...line(['d4'])]);
		const { removed } = movesRemovedByDelete(moves, moves[1]);
		expect(sans(moves, removed)).toEqual(['e5', 'Nf3']);
	});

	it('keeps a position another line transposes into', () => {
		// 1.Nf3 d5 2.d4 and 1.d4 d5 2.Nf3 reach the same position, which has 2...Nf6.
		const viaNf3 = line(['Nf3', 'd5', 'd4', 'Nf6']);
		const viaD4 = line(['d4', 'd5', 'Nf3']);
		expect(viaNf3[2].toFen).toBe(viaD4[2].toFen);
		const moves = withIds([...viaNf3, ...viaD4]);
		const { removed, unreachableFens } = movesRemovedByDelete(moves, moves[0]);
		expect(sans(moves, removed)).toEqual(['Nf3', 'd5', 'd4']);
		expect(unreachableFens.has(viaNf3[2].toFen)).toBe(false);
	});

	it("stops where a line cycles back to the deleted move's position", () => {
		const moves = withIds([
			...line(['e4', 'e5', 'Nf3', 'Nf6', 'Ng1', 'Ng8']),
			...line(['e4', 'e5', 'Bc4']).slice(2)
		]);
		const { removed } = movesRemovedByDelete(moves, moves[2]);
		expect(sans(moves, removed)).toEqual(['Nf3', 'Nf6', 'Ng1', 'Ng8']);
	});

	it('keeps the rest of the repertoire when a line cycles back to the start', () => {
		const moves = withIds([...line(['Nf3', 'Nf6', 'Ng1', 'Ng8']), ...line(['d4', 'd5'])]);
		const { removed } = movesRemovedByDelete(moves, moves[0]);
		expect(sans(moves, removed)).toEqual(['Nf3', 'Nf6', 'Ng1', 'Ng8']);
	});
});
