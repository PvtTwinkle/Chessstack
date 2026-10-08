// Authentication helpers — session creation, validation, and deletion.
//
// A session is a row in the `session` table that links a random token (UUID)
// to a user ID. The token is stored as a cookie in the browser.
//
// All functions here are async because the PostgreSQL driver is async.

import crypto from 'crypto';
import { error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { session } from '$lib/db/schema';
import { eq, lt } from 'drizzle-orm';

// Type-guard that throws 401 if the request is unauthenticated.
// Returns the non-null user object so TypeScript narrows the type
// and callers can use `user.id` etc. without further null checks.
type AuthenticatedUser = NonNullable<App.Locals['user']>;

export function requireUser(user: App.Locals['user']): AuthenticatedUser {
	if (!user) throw error(401, 'Not authenticated');
	return user;
}

// The cookie name. Must match exactly between the code that sets the cookie
// (login action) and the code that reads it (hooks.server.ts).
export const SESSION_COOKIE_NAME = 'chessstack_session';

// Secure cookies over HTTPS, plain cookies over HTTP (local dev).
// Controlled by the ORIGIN env var — https:// origins get secure cookies.
export const SECURE_COOKIE = (process.env.ORIGIN ?? '').startsWith('https://');

// Sessions are valid for 14 days. After this, the user must log in again.
const SESSION_DURATION_DAYS = 14;

// ─────────────────────────────────────────────────────────────────────────────
// createSession(userId)
//
// Called after a successful login. Creates a new row in the session table and
// returns the random token that should be stored in the browser cookie.
//
// crypto.randomUUID() generates a cryptographically random UUID like:
//   "f47ac10b-58cc-4372-a567-0e02b2c3d479"
// This is unpredictable enough that an attacker cannot guess it.
// ─────────────────────────────────────────────────────────────────────────────

export async function createSession(userId: number): Promise<string> {
	const token = crypto.randomUUID();

	const expiresAt = new Date();
	expiresAt.setDate(expiresAt.getDate() + SESSION_DURATION_DAYS);

	await db.insert(session).values({ id: token, userId, expiresAt });

	return token;
}

// ─────────────────────────────────────────────────────────────────────────────
// validateSession(token)
//
// Called on every request by hooks.server.ts. Looks up the token in the
// session table. Returns the userId if the session exists and has not expired,
// or null if it is invalid/expired.
//
// Expired sessions are deleted immediately when discovered — this keeps the
// session table from accumulating stale rows over time.
// ─────────────────────────────────────────────────────────────────────────────

export async function validateSession(token: string): Promise<{ userId: number } | null> {
	const [row] = await db.select().from(session).where(eq(session.id, token));

	if (!row) {
		// Token not found in the database — invalid or already deleted.
		return null;
	}

	if (row.expiresAt < new Date()) {
		// Token exists but has passed its expiry date — delete and reject.
		await db.delete(session).where(eq(session.id, token));
		return null;
	}

	return { userId: row.userId };
}

// ─────────────────────────────────────────────────────────────────────────────
// deleteSession(token)
//
// Called on logout. Removes the session row from the database so the token
// is immediately invalid — even if the browser still has the cookie.
// ─────────────────────────────────────────────────────────────────────────────

export async function deleteSession(token: string): Promise<void> {
	await db.delete(session).where(eq(session.id, token));
}

// ─────────────────────────────────────────────────────────────────────────────
// cleanExpiredSessions()
//
// Bulk-deletes all sessions past their expiry date. Called periodically by the
// import scheduler to prevent unbounded table growth in multi-user deployments.
// ─────────────────────────────────────────────────────────────────────────────

export async function cleanExpiredSessions(): Promise<number> {
	const result = await db.delete(session).where(lt(session.expiresAt, new Date())).returning();
	return result.length;
}
