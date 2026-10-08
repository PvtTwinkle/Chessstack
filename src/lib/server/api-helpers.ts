// Shared helpers for API route handlers.
// Keeps auth checks and parameter parsing DRY across all +server.ts files.

import { error } from '@sveltejs/kit';

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
 * Returns the authenticated admin user from locals, or throws 403.
 */
export function requireAdmin(locals: App.Locals) {
	if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Admin only');
	return locals.user;
}

/**
 * Parses a string parameter as an integer, or throws 400.
 * Intended for route params like `params.id`.
 */
export function parseIntParam(value: string | undefined, name: string): number {
	const n = parseInt(value ?? '', 10);
	if (isNaN(n)) throw error(400, `Invalid ${name}`);
	return n;
}
