import { describe, expect, it } from 'vitest';
import { candidateCount, toCandidates } from './candidates';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

describe('toCandidates', () => {
	it('converts to SAN and keeps White-to-move scores as they are', () => {
		expect(toCandidates(START, [{ uci: 'g1f3', scoreCp: 25, scoreMate: null }])).toEqual([
			{ san: 'Nf3', uci: 'g1f3', evalCp: 25, evalMate: null }
		]);
	});

	it("flips scores to White's perspective when Black is to move", () => {
		expect(
			toCandidates(AFTER_E4, [
				{ uci: 'c7c5', scoreCp: -30, scoreMate: null },
				{ uci: 'e7e5', scoreCp: null, scoreMate: 4 }
			])
		).toEqual([
			{ san: 'c5', uci: 'c7c5', evalCp: 30, evalMate: null },
			{ san: 'e5', uci: 'e7e5', evalCp: null, evalMate: -4 }
		]);
	});

	it('drops moves that are not legal in the position', () => {
		expect(toCandidates(START, [{ uci: 'e7e5', scoreCp: 0, scoreMate: null }])).toEqual([]);
	});

	it('returns nothing for an invalid FEN', () => {
		expect(toCandidates('not a fen', [{ uci: 'e2e4', scoreCp: 0, scoreMate: null }])).toEqual([]);
	});
});

describe('candidateCount', () => {
	it('caps the count at the number of legal moves', () => {
		expect(candidateCount(START, 3)).toBe(3);
		// A lone king in the corner has three moves.
		expect(candidateCount('7k/8/8/8/8/8/8/K7 w - - 0 1', 5)).toBe(3);
	});
});
