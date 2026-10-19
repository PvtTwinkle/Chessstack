// Dashboard maths, shared by the dashboard's server load and its component so
// the health score and the "what to do next" prompt can never disagree.
//
// Calendar days (the drill streak and the puzzle goal's period) are counted in
// the player's own time zone: a New Yorker who drills at 6 pm one day and 9 pm
// the next has drilled on two consecutive days, even though those are two UTC
// days apart. The browser reports its zone in the TIME_ZONE_COOKIE cookie;
// until it has, days fall back to UTC.

/** Cookie holding the browser's IANA time zone, e.g. "America/New_York". */
export const TIME_ZONE_COOKIE = 'tz';

/** How far back the streak looks. Longer streaks show as this many days. */
export const STREAK_LOOKBACK_DAYS = 400;

export type GoalFrequency = 'daily' | 'weekly' | 'monthly';

/** The zone itself if this runtime knows it, otherwise UTC. */
export function validTimeZone(zone: string | null | undefined): string {
	if (!zone || zone.length > 64) return 'UTC';
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: zone });
		return zone;
	} catch {
		return 'UTC';
	}
}

// The wall-clock date and time of an instant in a zone.
function wallClock(date: Date, timeZone: string) {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	}).formatToParts(date);
	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
	return {
		year: get('year'),
		month: get('month'),
		day: get('day'),
		hour: get('hour'),
		minute: get('minute'),
		second: get('second')
	};
}

/** The calendar day ("YYYY-MM-DD") an instant falls on in a zone. */
export function dayInZone(date: Date, timeZone: string): string {
	const { year, month, day } = wallClock(date, timeZone);
	return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// How far the zone's wall clock is ahead of UTC at an instant, in ms.
function zoneOffsetMs(date: Date, timeZone: string): number {
	const w = wallClock(date, timeZone);
	const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
	return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// The instant a wall-clock midnight happens in a zone. Asking for the offset
// twice settles the days when daylight saving time starts or ends.
function midnightInZone(year: number, month: number, day: number, timeZone: string): Date {
	const utcMidnight = Date.UTC(year, month - 1, day);
	let instant = utcMidnight - zoneOffsetMs(new Date(utcMidnight), timeZone);
	instant = utcMidnight - zoneOffsetMs(new Date(instant), timeZone);
	return new Date(instant);
}

/** The day before a "YYYY-MM-DD" day. */
export function previousDay(day: string): string {
	const date = new Date(`${day}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() - 1);
	return date.toISOString().slice(0, 10);
}

/**
 * Consecutive days with a completed drill session, counting back from today.
 * A streak survives until a whole day is missed: with no session yet today,
 * it counts from yesterday.
 */
export function computeStreak(sessionDays: Iterable<string>, today: string): number {
	const days = new Set(sessionDays);
	let day = days.has(today) ? today : previousDay(today);
	let streak = 0;
	while (days.has(day)) {
		streak++;
		day = previousDay(day);
	}
	return streak;
}

/**
 * When the puzzle goal's current period began: midnight today, on Monday this
 * week, or on the 1st of this month, in the player's zone.
 */
export function goalPeriodStart(now: Date, frequency: GoalFrequency, timeZone: string): Date {
	const { year, month, day } = wallClock(now, timeZone);
	if (frequency === 'monthly') return midnightInZone(year, month, 1, timeZone);
	if (frequency === 'weekly') {
		// getUTCDay() on the wall-clock date: 0 = Sunday ... 6 = Saturday.
		const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
		const monday = new Date(Date.UTC(year, month - 1, day - (dow === 0 ? 6 : dow - 1)));
		return midnightInZone(
			monday.getUTCFullYear(),
			monday.getUTCMonth() + 1,
			monday.getUTCDate(),
			timeZone
		);
	}
	return midnightInZone(year, month, day, timeZone);
}

export interface HealthInputs {
	totalCards: number;
	gapCount: number;
	masteredCount: number;
	dueCount: number;
	troubleCount: number;
}

/** The four parts of the health score, each 0–100. */
export interface HealthFactors {
	coverage: number;
	mastery: number;
	freshness: number;
	stability: number;
}

/** The health score's parts, or null when there are no cards to score. */
export function healthFactors(input: HealthInputs): HealthFactors | null {
	const { totalCards } = input;
	if (totalCards === 0) return null;
	return {
		// Each gap costs five points.
		coverage: Math.max(0, 100 - input.gapCount * 5),
		mastery: Math.round((input.masteredCount / totalCards) * 100),
		freshness: Math.round((1 - input.dueCount / totalCards) * 100),
		stability: Math.round((1 - input.troubleCount / totalCards) * 100)
	};
}

/** The composite health score, 0–100 (0 with no cards). */
export function healthScore(input: HealthInputs): number {
	const f = healthFactors(input);
	if (!f) return 0;
	return Math.round((f.coverage + f.mastery + f.freshness + f.stability) / 4);
}

/** The factor dragging the score down most; ties go to the first listed. */
export function weakestFactor(factors: HealthFactors): keyof HealthFactors {
	const order: (keyof HealthFactors)[] = ['freshness', 'coverage', 'mastery', 'stability'];
	return order.reduce((worst, key) => (factors[key] < factors[worst] ? key : worst));
}

/**
 * The document.cookie assignment that records the browser's zone, or null
 * when the cookie already holds it. Kept for a year; refreshed on each visit.
 */
export function timeZoneCookieUpdate(documentCookie: string, zone: string): string | null {
	const value = encodeURIComponent(zone);
	const current = documentCookie
		.split(';')
		.map((c) => c.trim())
		.find((c) => c.startsWith(`${TIME_ZONE_COOKIE}=`));
	if (current === `${TIME_ZONE_COOKIE}=${value}`) return null;
	return `${TIME_ZONE_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
}
