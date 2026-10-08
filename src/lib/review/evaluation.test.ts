import { describe, expect, it } from 'vitest';
import {
	computeCpl,
	evalBadgeClass,
	evalToWhiteCp,
	formatEval,
	formatPositionEval,
	getCplClass,
	isUserPly,
	plyToLabel,
	type PositionEval
} from './evaluation';

const cp = (evalCp: number): PositionEval => ({ evalCp, evalMate: null });
const mate = (evalMate: number): PositionEval => ({ evalCp: null, evalMate });

describe('formatEval / evalBadgeClass', () => {
	it('shows evals from the player perspective', () => {
		expect(formatEval(150, 'WHITE')).toBe('(+1.5)');
		expect(formatEval(150, 'BLACK')).toBe('(−1.5)');
		expect(formatEval(-35, 'BLACK')).toBe('(+0.3)');
		expect(formatEval(0, 'WHITE')).toBe('(=)');
	});

	it('classifies beyond half a pawn as good or bad', () => {
		expect(evalBadgeClass(51, 'WHITE')).toBe('eval-badge-good');
		expect(evalBadgeClass(51, 'BLACK')).toBe('eval-badge-bad');
		expect(evalBadgeClass(50, 'WHITE')).toBe('eval-badge-neutral');
		expect(evalBadgeClass(-50, 'WHITE')).toBe('eval-badge-neutral');
	});
});

describe('evalToWhiteCp', () => {
	it('passes centipawns through and maps mates to large values', () => {
		expect(evalToWhiteCp(cp(42))).toBe(42);
		expect(evalToWhiteCp(mate(1))).toBe(9990);
		expect(evalToWhiteCp(mate(-3))).toBe(-9970);
		expect(evalToWhiteCp({ evalCp: null, evalMate: null })).toBeNull();
	});

	it('ranks a quicker mate above a slower one', () => {
		expect(evalToWhiteCp(mate(1))!).toBeGreaterThan(evalToWhiteCp(mate(5))!);
	});
});

describe('computeCpl', () => {
	const evals = new Map<number, PositionEval>([
		[0, cp(20)],
		[1, cp(30)], // White improved: 0 loss
		[2, cp(150)], // Black dropped 120
		[3, cp(-50)] // White dropped 200
	]);

	it('measures loss from the mover perspective', () => {
		expect(computeCpl(1, evals)).toBe(0);
		expect(computeCpl(2, evals)).toBe(120);
		expect(computeCpl(3, evals)).toBe(200);
	});

	it('returns null until both surrounding evals exist', () => {
		expect(computeCpl(4, evals)).toBeNull();
		expect(computeCpl(1, new Map([[1, cp(0)]]))).toBeNull();
	});

	it('classifies a move into a forced mate as a blunder', () => {
		const m = new Map([
			[0, cp(0)],
			[1, mate(-2)]
		]);
		expect(getCplClass(computeCpl(1, m)!)).toBe('blunder');
	});
});

describe('getCplClass', () => {
	it.each([
		[0, 'best'],
		[10, 'best'],
		[11, 'good'],
		[50, 'good'],
		[100, 'inaccuracy'],
		[200, 'mistake'],
		[201, 'blunder']
	] as const)('%i → %s', (value, cls) => {
		expect(getCplClass(value)).toBe(cls);
	});
});

describe('formatPositionEval', () => {
	it('formats mates and centipawns from the player perspective', () => {
		expect(formatPositionEval(mate(3), 'WHITE')).toBe('M3');
		expect(formatPositionEval(mate(3), 'BLACK')).toBe('-M3');
		expect(formatPositionEval(cp(-120), 'BLACK')).toBe('(+1.2)');
		expect(formatPositionEval({ evalCp: null, evalMate: null }, 'WHITE')).toBe('');
	});
});

describe('move helpers', () => {
	it('plyToLabel numbers moves for both sides', () => {
		expect(plyToLabel(1)).toBe('1.');
		expect(plyToLabel(2)).toBe('1…');
		expect(plyToLabel(3)).toBe('2.');
	});

	it('isUserPly follows the player colour', () => {
		expect(isUserPly(1, 'WHITE')).toBe(true);
		expect(isUserPly(2, 'WHITE')).toBe(false);
		expect(isUserPly(2, 'BLACK')).toBe(true);
	});
});
