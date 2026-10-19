import { afterEach, describe, expect, it, vi } from 'vitest';
import { timeWindowToSince } from './timeWindow';

const DAY = 86_400_000;

describe('timeWindowToSince', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('goes back the window from now', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-06-01T00:00:00Z'));
		const now = Date.now();
		expect(timeWindowToSince('1m')).toBe(now - 30 * DAY);
		expect(timeWindowToSince('3m')).toBe(now - 90 * DAY);
		expect(timeWindowToSince('6m')).toBe(now - 180 * DAY);
		expect(timeWindowToSince('1y')).toBe(now - 365 * DAY);
	});

	it('has no lower bound for all time, no window or an unknown one', () => {
		expect(timeWindowToSince('all')).toBeUndefined();
		expect(timeWindowToSince(undefined)).toBeUndefined();
		expect(timeWindowToSince('2w')).toBeUndefined();
	});
});
