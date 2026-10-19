import { describe, expect, it } from 'vitest';
import {
	computeStreak,
	dayInZone,
	goalPeriodStart,
	healthFactors,
	healthScore,
	previousDay,
	timeZoneCookieUpdate,
	validTimeZone,
	weakestFactor
} from './stats';

describe('validTimeZone', () => {
	it('keeps a known zone and falls back to UTC otherwise', () => {
		expect(validTimeZone('America/New_York')).toBe('America/New_York');
		expect(validTimeZone('Not/A_Zone')).toBe('UTC');
		expect(validTimeZone('')).toBe('UTC');
		expect(validTimeZone(undefined)).toBe('UTC');
	});
});

describe('dayInZone', () => {
	it('puts an evening in New York on the local day, not the UTC one', () => {
		const ninePmNewYork = new Date('2026-03-11T01:00:00Z'); // 9 pm EDT on 10 March
		expect(dayInZone(ninePmNewYork, 'UTC')).toBe('2026-03-11');
		expect(dayInZone(ninePmNewYork, 'America/New_York')).toBe('2026-03-10');
	});
});

describe('previousDay', () => {
	it('crosses month and year ends', () => {
		expect(previousDay('2026-03-01')).toBe('2026-02-28');
		expect(previousDay('2024-03-01')).toBe('2024-02-29');
		expect(previousDay('2026-01-01')).toBe('2025-12-31');
	});
});

describe('computeStreak', () => {
	it('counts consecutive days back from today', () => {
		expect(computeStreak(['2026-05-10', '2026-05-09', '2026-05-08'], '2026-05-10')).toBe(3);
	});

	it('starts from yesterday when there is no session yet today', () => {
		expect(computeStreak(['2026-05-09', '2026-05-08'], '2026-05-10')).toBe(2);
	});

	it('stops at a missed day', () => {
		expect(computeStreak(['2026-05-10', '2026-05-08', '2026-05-07'], '2026-05-10')).toBe(1);
		expect(computeStreak(['2026-05-08'], '2026-05-10')).toBe(0);
		expect(computeStreak([], '2026-05-10')).toBe(0);
	});

	it('keeps a New York evening streak that UTC days would break', () => {
		// 6 pm and then 9 pm EDT on consecutive evenings.
		const sessions = [new Date('2026-05-08T22:00:00Z'), new Date('2026-05-10T01:00:00Z')];
		const now = new Date('2026-05-10T01:30:00Z');
		const zone = 'America/New_York';
		expect(
			computeStreak(
				sessions.map((d) => dayInZone(d, zone)),
				dayInZone(now, zone)
			)
		).toBe(2);
		expect(
			computeStreak(
				sessions.map((d) => dayInZone(d, 'UTC')),
				dayInZone(now, 'UTC')
			)
		).toBe(1);
	});
});

describe('goalPeriodStart', () => {
	// Wednesday 15 April 2026, 10:30 UTC.
	const now = new Date('2026-04-15T10:30:00Z');

	it('starts a daily goal at midnight in the zone', () => {
		expect(goalPeriodStart(now, 'daily', 'UTC').toISOString()).toBe('2026-04-15T00:00:00.000Z');
		// Midnight EDT is 04:00 UTC.
		expect(goalPeriodStart(now, 'daily', 'America/New_York').toISOString()).toBe(
			'2026-04-15T04:00:00.000Z'
		);
	});

	it('starts a weekly goal on Monday', () => {
		expect(goalPeriodStart(now, 'weekly', 'UTC').toISOString()).toBe('2026-04-13T00:00:00.000Z');
		// A Sunday belongs to the week that began six days earlier.
		const sunday = new Date('2026-04-19T12:00:00Z');
		expect(goalPeriodStart(sunday, 'weekly', 'UTC').toISOString()).toBe('2026-04-13T00:00:00.000Z');
	});

	it('starts a monthly goal on the 1st', () => {
		expect(goalPeriodStart(now, 'monthly', 'UTC').toISOString()).toBe('2026-04-01T00:00:00.000Z');
		expect(goalPeriodStart(now, 'monthly', 'Asia/Tokyo').toISOString()).toBe(
			'2026-03-31T15:00:00.000Z'
		);
	});

	it('handles a day when the clocks change', () => {
		// US clocks go forward at 2 am on 8 March 2026; midnight is still EST (UTC-5).
		const afternoon = new Date('2026-03-08T20:00:00Z');
		expect(goalPeriodStart(afternoon, 'daily', 'America/New_York').toISOString()).toBe(
			'2026-03-08T05:00:00.000Z'
		);
	});

	it('handles a half-hour zone', () => {
		expect(goalPeriodStart(now, 'daily', 'Asia/Kolkata').toISOString()).toBe(
			'2026-04-14T18:30:00.000Z'
		);
	});
});

describe('health', () => {
	const input = { totalCards: 20, gapCount: 2, masteredCount: 10, dueCount: 5, troubleCount: 1 };

	it('scores each factor and averages them', () => {
		expect(healthFactors(input)).toEqual({
			coverage: 90,
			mastery: 50,
			freshness: 75,
			stability: 95
		});
		expect(healthScore(input)).toBe(78);
	});

	it('is empty with no cards', () => {
		expect(healthFactors({ ...input, totalCards: 0 })).toBeNull();
		expect(healthScore({ ...input, totalCards: 0 })).toBe(0);
	});

	it('names the weakest factor, preferring due cards on a tie', () => {
		expect(weakestFactor(healthFactors(input)!)).toBe('mastery');
		expect(weakestFactor({ coverage: 50, mastery: 60, freshness: 50, stability: 70 })).toBe(
			'freshness'
		);
	});
});

describe('timeZoneCookieUpdate', () => {
	it('sets the cookie when it is missing or out of date', () => {
		expect(timeZoneCookieUpdate('', 'Europe/Paris')).toBe(
			'tz=Europe%2FParis; path=/; max-age=31536000; samesite=lax'
		);
		expect(timeZoneCookieUpdate('a=1; tz=UTC', 'Europe/Paris')).toMatch(/^tz=Europe%2FParis;/);
	});

	it('leaves a current cookie alone', () => {
		expect(timeZoneCookieUpdate('a=1; tz=Europe%2FParis; b=2', 'Europe/Paris')).toBeNull();
	});
});
