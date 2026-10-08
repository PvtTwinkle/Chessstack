import { describe, expect, it } from 'vitest';
import { bracketMidpoint, computeRatingChange, evalToScore } from './trainer';
import { bracketForRating } from './ratings';

describe('evalToScore', () => {
	it('maps 0cp to 0.5 and is symmetric between colors', () => {
		expect(evalToScore(0, 'WHITE')).toBe(0.5);
		expect(evalToScore(200, 'WHITE')).toBeCloseTo(1 - evalToScore(200, 'BLACK'), 10);
	});

	it('matches the documented sigmoid examples', () => {
		expect(evalToScore(400, 'WHITE')).toBeCloseTo(0.91, 2);
		expect(evalToScore(-200, 'WHITE')).toBeCloseTo(0.24, 2);
	});

	it('maps mate scores to 1 or 0', () => {
		expect(evalToScore(Infinity, 'WHITE')).toBe(1);
		expect(evalToScore(Infinity, 'BLACK')).toBe(0);
		expect(evalToScore(-Infinity, 'BLACK')).toBe(1);
	});
});

describe('computeRatingChange', () => {
	it('is zero for the expected score against an equal opponent', () => {
		expect(computeRatingChange(0.5, 1500, 1500)).toBe(0);
	});

	it('rewards beating a stronger bracket more than a weaker one', () => {
		expect(computeRatingChange(1, 1900, 1500)).toBeGreaterThan(computeRatingChange(1, 1100, 1500));
	});

	it('is bounded by K', () => {
		expect(computeRatingChange(1, 3000, 800)).toBeLessThanOrEqual(32);
		expect(computeRatingChange(0, 800, 3000)).toBeGreaterThanOrEqual(-32);
	});
});

describe('rating brackets', () => {
	it.each([
		[500, 0],
		[1000, 0],
		[1001, 1],
		[1200, 1],
		[1201, 2],
		[1600, 3],
		[2399, 7],
		[2400, null]
	])('bracketForRating(%i) = %s', (elo, expected) => {
		expect(bracketForRating(elo)).toBe(expected);
	});

	it('bracketMidpoint handles masters and out-of-range ids', () => {
		expect(bracketMidpoint(null)).toBe(2500);
		expect(bracketMidpoint(-1)).toBe(2500);
		expect(bracketMidpoint(3)).toBe(1501);
		expect(bracketMidpoint(99)).toBe(1500);
	});
});
