import { describe, expect, it } from 'vitest';
import { formatDate, isLifetimeGift } from './admin-user';

describe('isLifetimeGift', () => {
	it('treats year 9999 expiries as lifetime', () => {
		expect(isLifetimeGift(new Date('9999-12-31T00:00:00Z'))).toBe(true);
		expect(isLifetimeGift('9999-12-31T00:00:00.000Z')).toBe(true);
	});

	it('is false for normal expiries and missing dates', () => {
		expect(isLifetimeGift(new Date('2027-06-30'))).toBe(false);
		expect(isLifetimeGift(null)).toBe(false);
	});
});

describe('formatDate', () => {
	it('formats dates and accepts ISO strings', () => {
		const d = new Date(2025, 0, 1, 12);
		expect(formatDate(d)).toBe(
			d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
		);
		expect(formatDate(d.toISOString())).toBe(formatDate(d));
	});

	it('returns an empty string for no date', () => {
		expect(formatDate(null)).toBe('');
	});
});
