import { describe, expect, it } from 'vitest';
import { getLockedRepertoireIds, TIER_LIMITS } from './tiers';

describe('getLockedRepertoireIds', () => {
	const reps = [{ id: 10 }, { id: 4 }, { id: 7 }];

	it('locks every repertoire except the first (oldest) for free users', () => {
		expect([...getLockedRepertoireIds(reps, 'free')]).toEqual([4, 7]);
	});

	it('locks nothing for paid users', () => {
		expect(getLockedRepertoireIds(reps, 'paid').size).toBe(0);
	});

	it('locks nothing when a free user has zero or one repertoire', () => {
		expect(getLockedRepertoireIds([], 'free').size).toBe(0);
		expect(getLockedRepertoireIds([{ id: 1 }], 'free').size).toBe(0);
	});

	it('free tier limit matches the locking rule', () => {
		expect(TIER_LIMITS.free.maxRepertoires).toBe(1);
		expect(TIER_LIMITS.paid.maxRepertoires).toBe(Infinity);
	});
});
