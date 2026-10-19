// Database-backed rate limiting — works across multiple app instances.
//
// Each rate limit check is an upsert: if the key doesn't exist or the window
// has expired, insert/reset it. If it exists and is within the window,
// increment the counter and check against the max.

import { db, getRawSql } from '$lib/db';
import { rateLimit } from '$lib/db/schema';
import { eq, lt } from 'drizzle-orm';

interface RateLimitOptions {
	/** Prefix for the key, e.g. "login" or "register". Combined with the id to form the full key. */
	prefix: string;
	/** Maximum attempts allowed within the window. */
	max: number;
	/** Window duration in milliseconds. */
	windowMs: number;
}

/**
 * Check if an id (usually the client IP; a username or user id for per-account
 * limits) is rate limited for a specific action.
 * Returns true if the id has exceeded the limit, false otherwise.
 * Each call increments the counter (call only on the event you want to limit).
 */
export async function isRateLimited(id: string, opts: RateLimitOptions): Promise<boolean> {
	const key = `${opts.prefix}:${id}`;
	const sql = getRawSql();

	// Upsert: insert if new, or reset if expired, or increment if within window.
	// Returns the count AFTER this attempt. The window is measured with the
	// database's clock on both sides, the same NOW() that stamped window_start,
	// so app and database time zones can't skew it.
	const [row] = await sql<[{ count: number }]>`
		INSERT INTO rate_limit (key, count, window_start)
		VALUES (${key}, 1, NOW())
		ON CONFLICT (key) DO UPDATE SET
			count = CASE
				WHEN rate_limit.window_start < NOW() - make_interval(secs => ${opts.windowMs / 1000})
				THEN 1
				ELSE rate_limit.count + 1
			END,
			window_start = CASE
				WHEN rate_limit.window_start < NOW() - make_interval(secs => ${opts.windowMs / 1000})
				THEN NOW()
				ELSE rate_limit.window_start
			END
		RETURNING count
	`;

	return row.count > opts.max;
}

/**
 * Reset the rate limit counter for a given id and action.
 */
export async function resetRateLimit(id: string, prefix: string): Promise<void> {
	await db.delete(rateLimit).where(eq(rateLimit.key, `${prefix}:${id}`));
}

// No limit's window is longer than an hour, so a day-old counter is dead.
const RATE_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Deletes rate-limit counters whose window ended long ago. Returns the count. */
export async function pruneRateLimits(): Promise<number> {
	const result = await db
		.delete(rateLimit)
		.where(lt(rateLimit.windowStart, new Date(Date.now() - RATE_LIMIT_RETENTION_MS)));
	return result.count;
}
