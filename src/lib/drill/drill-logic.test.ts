import { describe, expect, it } from 'vitest';
import {
	computePlyDepths,
	enumerateLines,
	formatNextSession,
	getMoveNumber,
	getSection,
	scoreLine,
	sortLinesByWeakness
} from './drill-logic';
import type { DueCard, RepertoireMove } from './types';
import { parseVariationPgn } from '$lib/pgn/parseVariations';

function movesFrom(pgn: string, color: 'WHITE' | 'BLACK' = 'WHITE'): RepertoireMove[] {
	return parseVariationPgn(pgn, color).edges.map((e, i) => ({
		id: i + 1,
		fromFen: e.fromFen,
		toFen: e.toFen,
		san: e.san,
		notes: null
	}));
}

function card(fromFen: string, san: string, lapses = 0): DueCard {
	return {
		id: 1,
		fromFen,
		san,
		state: 2,
		due: null,
		stability: null,
		difficulty: null,
		elapsedDays: null,
		scheduledDays: null,
		reps: 1,
		lapses,
		lastReview: null,
		learningSteps: 0,
		intervalLabels: { forgot: '', unsure: '', easy: '' }
	};
}

const sans = (line: { san: string }[]) => line.map((s) => s.san).join(' ');

describe('enumerateLines', () => {
	it('returns every root-to-leaf line with the user moves marked', () => {
		const moves = movesFrom('1. e4 e5 (1... c5 2. Nf3) 2. Nf3 Nc6');
		const lines = enumerateLines(moves, 'WHITE');
		expect(lines.map(sans).sort()).toEqual(['e4 c5 Nf3', 'e4 e5 Nf3 Nc6']);
		const main = lines.find((l) => sans(l) === 'e4 e5 Nf3 Nc6')!;
		expect(main.map((s) => s.isUserMove)).toEqual([true, false, true, false]);
	});

	it('marks Black moves as the user moves for a Black repertoire', () => {
		const lines = enumerateLines(movesFrom('1. e4 c5 2. Nf3 d6', 'BLACK'), 'BLACK');
		expect(lines[0].map((s) => s.isUserMove)).toEqual([false, true, false, true]);
	});

	it('returns nothing for an empty repertoire', () => {
		expect(enumerateLines([], 'WHITE')).toEqual([]);
	});

	it('terminates on a cycle back to an earlier position', () => {
		// 1. Nf3 Nf6 2. Ng1 Ng8 returns to the start position. The looping move is
		// skipped, and a branch that only loops back yields no line.
		const lines = enumerateLines(movesFrom('1. Nf3 Nf6 2. Ng1 Ng8 (2... e5)'), 'WHITE');
		expect(lines.map(sans)).toEqual(['Nf3 Nf6 Ng1 e5']);
	});
});

describe('scoreLine / sortLinesByWeakness', () => {
	const moves = movesFrom('1. e4 e5 (1... c5 2. Nf3) 2. Nf3 Nc6 3. Bb5');
	const lines = enumerateLines(moves, 'WHITE');
	const main = lines.find((l) => l.length === 5)!;
	const sicilian = lines.find((l) => l.length === 3)!;
	const bb5 = main[4];

	it('scores +3 per due user move and ignores opponent moves', () => {
		expect(scoreLine(main, [])).toBe(0);
		expect(scoreLine(main, [card(bb5.fromFen, 'Bb5')])).toBe(3);
		expect(scoreLine(main, [card(main[0].fromFen, 'e4'), card(bb5.fromFen, 'Bb5')])).toBe(6);
		expect(scoreLine(main, [card(main[1].fromFen, 'e5')])).toBe(0); // opponent move
	});

	it('gives no extra weight to lapsed cards (documented limitation)', () => {
		expect(scoreLine(main, [card(bb5.fromFen, 'Bb5', 3)])).toBe(3);
	});

	it('puts the most urgent line first and breaks ties with the random source', () => {
		const due = [card(bb5.fromFen, 'Bb5')];
		expect(sortLinesByWeakness([sicilian, main], due, () => 0.5)[0]).toBe(main);
		let n = 0;
		const sequence = () => [0.9, 0.1][n++];
		expect(sortLinesByWeakness([main, sicilian], [], sequence)[0]).toBe(sicilian);
	});
});

describe('depth sections', () => {
	const RUY =
		'1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O ' +
		'9. h3 Nb8 10. d4 Nbd7 11. Nbd2 Bb7 12. Bc2 Re8 13. Nf1 Bf8 14. Ng3 g6 15. a4 c5 ' +
		'16. d5 c4 17. Bg5 h6';
	const moves = movesFrom(RUY);
	const depths = computePlyDepths(moves);
	const fenBefore = (san: string, nth = 0) => moves.filter((m) => m.san === san)[nth].fromFen;

	it('computes plies from the start position', () => {
		expect(depths.get(fenBefore('e4'))).toBe(0);
		expect(depths.get(fenBefore('Nf3'))).toBe(2);
		expect(depths.get(fenBefore('h6'))).toBe(33);
	});

	it('uses the shortest path for transpositions', () => {
		// 1. Nf3 d5 2. d4 and 1. d4 d5 2. Nf3 reach the same position in 3 plies.
		const t = computePlyDepths(
			movesFrom('1. Nf3 d5 2. d4 Nf6 (2... c6) 1... Nf6 (1. d4 d5 2. Nf3 e6)')
		);
		const both = movesFrom('1. Nf3 d5 2. d4 Nf6').find((m) => m.san === 'Nf6')!.fromFen;
		expect(t.get(both)).toBe(3);
	});

	it('puts moves into sections by their real move number (4-field FENs)', () => {
		// Stored FENs have no move counters; without depths everything was "move 1".
		expect(fenBefore('Bb5').split(' ')).toHaveLength(4);
		expect(getSection(fenBefore('Bb5'))).toBe('foundations'); // the old behaviour
		expect(getSection(fenBefore('Bb5'), depths)).toBe('foundations'); // move 3
		expect(getSection(fenBefore('O-O'), depths)).toBe('foundations'); // move 5
		expect(getSection(fenBefore('Re1'), depths)).toBe('mainlines'); // move 6
		expect(getSection(fenBefore('a4'), depths)).toBe('mainlines'); // move 15
		expect(getSection(fenBefore('d5'), depths)).toBe('deep'); // move 16
		expect(getSection(fenBefore('h6'), depths)).toBe('deep'); // move 17
	});

	it('falls back to the FEN move counter for positions outside the tree', () => {
		expect(getSection('8/8/8/8/8/8/8/K6k w - - 0 12', depths)).toBe('mainlines');
		expect(getMoveNumber('8/8/8/8/8/8/8/K6k w - -')).toBe(1);
	});

	it('reads the full-move number from a 6-field FEN', () => {
		expect(getMoveNumber('8/8/8/8/8/8/8/K6k w - - 0 12')).toBe(12);
		expect(getSection('8/8/8/8/8/8/8/K6k w - - 0 5')).toBe('foundations');
		expect(getSection('8/8/8/8/8/8/8/K6k w - - 0 16')).toBe('deep');
	});
});

describe('formatNextSession', () => {
	const now = new Date(2026, 9, 2, 10, 0);

	it('labels today, tomorrow and later days', () => {
		expect(formatNextSession(new Date(2026, 9, 2, 14, 30).toISOString(), now)).toMatch(
			/^Today at /
		);
		expect(formatNextSession(new Date(2026, 9, 3, 9, 0).toISOString(), now)).toMatch(
			/^Tomorrow at /
		);
		expect(formatNextSession(new Date(2026, 9, 6, 9, 0).toISOString(), now)).toBe('In 4 days');
	});
});
