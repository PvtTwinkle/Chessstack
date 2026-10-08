import { describe, expect, it } from 'vitest';
import { getHintSquare, getMoveSquares } from './squares';
import { STARTING_FEN } from '$lib/fen';

const START = `${STARTING_FEN} 0 1`;

describe('getMoveSquares', () => {
	it('resolves legal moves', () => {
		expect(getMoveSquares(START, 'Nf3')).toEqual({ from: 'g1', to: 'f3' });
		expect(getMoveSquares(START, 'e4')).toEqual({ from: 'e2', to: 'e4' });
	});

	it('returns null for illegal moves and invalid positions', () => {
		expect(getMoveSquares(START, 'Nf6')).toBeNull();
		expect(getMoveSquares('not a fen', 'e4')).toBeNull();
	});
});

describe('getHintSquare', () => {
	it('returns the origin square of the move', () => {
		expect(getHintSquare(START, 'Nc3')).toBe('b1');
		expect(getHintSquare(START, 'Ke2')).toBeNull();
	});
});
