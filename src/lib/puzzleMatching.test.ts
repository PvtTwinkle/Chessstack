import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import {
	getDeepestEcoNames,
	normalizeOpening,
	removeParentNames,
	resolvePuzzleFamilies
} from './puzzleMatching';
import { fenKey, STARTING_FEN } from './fen';

describe('normalizeOpening', () => {
	it('matches ECO names to Lichess tags', () => {
		expect(normalizeOpening('Sicilian Defense, Najdorf Variation')).toBe(
			'sicilian defense najdorf variation'
		);
		expect(normalizeOpening('Sicilian_Defense_Najdorf_Variation')).toBe(
			'sicilian defense najdorf variation'
		);
	});

	it('drops apostrophes, colons and extra spaces', () => {
		expect(normalizeOpening("King's  Gambit Accepted: Fischer")).toBe(
			'kings gambit accepted fischer'
		);
	});
});

describe('removeParentNames', () => {
	it('keeps only the most specific names', () => {
		expect(
			removeParentNames([
				'scotch game',
				'scotch game scotch gambit',
				'sicilian defense',
				'sicilian defense alapin variation'
			]).sort()
		).toEqual(['scotch game scotch gambit', 'sicilian defense alapin variation']);
	});

	it('only treats whole words as a parent', () => {
		// "italian game" is a prefix of "italian gameplay" but not a parent of it.
		expect(removeParentNames(['italian game', 'italian gameplay']).sort()).toEqual([
			'italian game',
			'italian gameplay'
		]);
	});
});

/** Repertoire rows for a line of SAN moves from the start. */
function line(...sans: string[]) {
	const chess = new Chess();
	return sans.map((san) => {
		const fromFen = chess.fen();
		chess.move(san);
		return { fromFen, toFen: chess.fen() };
	});
}

function fenAfter(...sans: string[]): string {
	const chess = new Chess();
	for (const san of sans) chess.move(san);
	return fenKey(chess.fen());
}

describe('getDeepestEcoNames', () => {
	const eco = new Map([
		[fenAfter('e4', 'e5', 'Nf3'), "King's Knight Opening"],
		[fenAfter('e4', 'e5', 'Nf3', 'Nc6', 'd4'), 'Scotch Game'],
		[fenAfter('e4', 'c5'), 'Sicilian Defense']
	]);

	it('takes the deepest name on each branch', () => {
		const moves = [...line('e4', 'e5', 'Nf3', 'Nc6', 'd4'), ...line('e4', 'c5', 'Nf3')];
		expect([...getDeepestEcoNames(moves, eco, STARTING_FEN)].sort()).toEqual([
			'Scotch Game',
			'Sicilian Defense'
		]);
	});

	it('keeps a transit name when the branch goes no deeper', () => {
		expect([...getDeepestEcoNames(line('e4', 'e5', 'Nf3'), eco, STARTING_FEN)]).toEqual([
			"King's Knight Opening"
		]);
	});

	it('stops at a transposition back into a visited position', () => {
		// Knights out and back return to the start position.
		const moves = line('Nf3', 'Nf6', 'Ng1', 'Ng8');
		expect(getDeepestEcoNames(moves, eco, STARTING_FEN).size).toBe(0);
	});
});

describe('resolvePuzzleFamilies', () => {
	const known = new Set(['scotch game', 'scotch game scotch gambit', 'sicilian defense']);

	it('cuts a name back to the nearest known family', () => {
		expect(
			resolvePuzzleFamilies(['scotch game classical variation intermezzo variation'], known)
		).toEqual(['scotch game']);
	});

	it('drops names with no family and parents of another result', () => {
		expect(
			resolvePuzzleFamilies(['scotch game', 'scotch game scotch gambit', 'english opening'], known)
		).toEqual(['scotch game scotch gambit']);
	});
});
