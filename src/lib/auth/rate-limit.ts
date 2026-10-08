// Database-backed rate limiting — works across multiple app instances.
//
// Each rate limit check is an upsert: if the key doesn't exist or the window
// has expired, insert/reset it. If it exists and is within the window,
// increment the counter and check against the max.

import { getRawSql } from '$lib/db';

interface RateLimitOptions {
	/** Prefix for the key, e.g. "login" or "register". Combined with the IP to form the full key. */
	prefix: string;
	/** Maximum attempts allowed within the window. */
	max: number;
	/** Window duration in milliseconds. */
	windowMs: number;
}

/**
 * Check if a given IP is rate limited for a specific action.
 * Returns true if the IP has exceeded the limit, false otherwise.
 * Each call increments the counter (call only on the event you want to limit).
 */
export async function isRateLimited(ip: string, opts: RateLimitOptions): Promise<boolean> {
	const key = `${opts.prefix}:${ip}`;
	const windowStart = new Date(Date.now() - opts.windowMs);
	const sql = getRawSql();

	// Upsert: insert if new, or reset if expired, or increment if within window.
	// Returns the count AFTER this attempt.
	const [row] = await sql<[{ count: number }]>`
		INSERT INTO rate_limit (key, count, window_start)
		VALUES (${key}, 1, NOW())
		ON CONFLICT (key) DO UPDATE SET
			count = CASE
				WHEN rate_limit.window_start < ${windowStart.toISOString()}::timestamp
				THEN 1
				ELSE rate_limit.count + 1
			END,
			window_start = CASE
				WHEN rate_limit.window_start < ${windowStart.toISOString()}::timestamp
				THEN NOW()
				ELSE rate_limit.window_start
			END
		RETURNING count
	`;

	return row.count > opts.max;
}

/**
 * Reset the rate limit counter for a given IP and action.
 * Call this on successful login to clear the failed attempt counter.
 */
export async function resetRateLimit(ip: string, prefix: string): Promise<void> {
	const key = `${prefix}:${ip}`;
	const sql = getRawSql();
	await sql`DELETE FROM rate_limit WHERE key = ${key}`;
}
