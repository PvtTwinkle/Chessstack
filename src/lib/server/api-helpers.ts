// Shared helpers for API route handlers.
// Keeps auth checks and parameter parsing DRY across all +server.ts files.

import { error, json } from '@sveltejs/kit';
import { isRateLimited } from '$lib/auth/rate-limit';
import { MAX_DB_ID } from '$lib/validation-limits';

/**
 * Returns the authenticated user from locals, or throws 401.
 * The return type is narrowed to non-null so callers can use `user.id`
 * without additional null checks.
 */
export function requireAuth(locals: App.Locals) {
	if (!locals.user) throw error(401, 'Not authenticated');
	return locals.user;
}

/**
 * Returns the authenticated admin user from locals. Throws 401 when nobody is
 * signed in and 403 when the user is not an admin.
 */
export function requireAdmin(locals: App.Locals) {
	const user = requireAuth(locals);
	if (user.role !== 'admin') throw error(403, 'Admin only');
	return user;
}

/**
 * Parses a route param such as `params.id` as a database id, or throws 400.
 * Strict: `12abc`, `-1`, `0` and anything past int4 are rejected, so bad
 * input never reaches Postgres as an out-of-range error and a 500.
 */
export function parseIntParam(value: string | undefined, name: string): number {
	if (!value || !/^\d{1,10}$/.test(value)) throw error(400, `Invalid ${name}`);
	const n = Number(value);
	if (n < 1 || n > MAX_DB_ID) throw error(400, `Invalid ${name}`);
	return n;
}

interface RateLimit {
	prefix: string;
	max: number;
	windowMs: number;
}

/**
 * Counts one request against a per-user limit from RATE_LIMITS. Returns the
 * 429 response to send once the user is over it, or null. SvelteKit's error()
 * can't carry a Retry-After header, so handlers return the response:
 *
 *   const limited = await rateLimitResponse(user.id, RATE_LIMITS.book);
 *   if (limited) return limited;
 */
export async function rateLimitResponse(
	userId: number,
	limit: RateLimit
): Promise<Response | null> {
	if (!(await isRateLimited(String(userId), limit))) return null;
	return json(
		{ message: 'Too many requests. Please try again later.' },
		{ status: 429, headers: { 'retry-after': String(Math.ceil(limit.windowMs / 1000)) } }
	);
}
