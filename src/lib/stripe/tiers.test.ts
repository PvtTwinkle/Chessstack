import { describe, expect, it } from 'vitest';
import { effectiveTier, getLockedRepertoireIds, isGiftActive, TIER_LIMITS } from './tiers';

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

describe('effectiveTier', () => {
	const now = new Date('2026-10-12T12:00:00Z');
	const tomorrow = new Date('2026-10-13T12:00:00Z');
	const yesterday = new Date('2026-10-11T12:00:00Z');

	it('is free without a subscription row', () => {
		expect(effectiveTier(undefined, now)).toBe('free');
		expect(effectiveTier(null, now)).toBe('free');
	});

	it('follows the Stripe tier when there is no gift', () => {
		expect(effectiveTier({ tier: 'paid', giftExpiry: null }, now)).toBe('paid');
		expect(effectiveTier({ tier: 'free', giftExpiry: null }, now)).toBe('free');
	});

	it('is paid while a gift is active', () => {
		expect(effectiveTier({ tier: 'free', giftExpiry: tomorrow }, now)).toBe('paid');
		expect(effectiveTier({ tier: 'free', giftExpiry: new Date('9999-12-31T00:00:00Z') }, now)).toBe(
			'paid'
		);
	});

	it('falls back to the Stripe tier once a gift expires', () => {
		expect(effectiveTier({ tier: 'free', giftExpiry: yesterday }, now)).toBe('free');
		expect(effectiveTier({ tier: 'paid', giftExpiry: yesterday }, now)).toBe('paid');
	});

	it('accepts serialized dates', () => {
		expect(isGiftActive(tomorrow.toISOString(), now)).toBe(true);
		expect(isGiftActive(yesterday.toISOString(), now)).toBe(false);
		expect(isGiftActive(now, now)).toBe(false);
	});
});
