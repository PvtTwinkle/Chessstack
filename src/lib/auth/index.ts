// Authentication helpers — session creation, validation, and deletion.
//
// A session is a row in the `session` table that links a random token to a
// user ID. The browser keeps the token in a cookie; the table keeps only its
// SHA-256 hash, so a leaked database backup can't be replayed as live logins.
//
// All functions here are async because the PostgreSQL driver is async.

import crypto from 'crypto';
import type { Cookies } from '@sveltejs/kit';
import { db } from '$lib/db';
import { emailVerificationToken, passwordResetToken, session } from '$lib/db/schema';
import { eq, lt } from 'drizzle-orm';
import { hashToken } from './token-hash';

// The cookie name. Must match exactly between the code that sets the cookie
// (login action) and the code that reads it (hooks.server.ts).
export const SESSION_COOKIE_NAME = 'chessstack_session';

// Secure cookies over HTTPS, plain cookies over HTTP (local dev).
// Controlled by the ORIGIN env var — https:// origins get secure cookies.
export const SECURE_COOKIE = (process.env.ORIGIN ?? '').startsWith('https://');

// Sessions last 14 days from the last visit: each request renews one that has
// been running for over a day, so someone who uses the app stays signed in and
// a session is written at most once a day.
const SESSION_DURATION_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_DURATION_MS = SESSION_DURATION_DAYS * DAY_MS;
const SESSION_RENEW_BELOW_MS = SESSION_DURATION_MS - DAY_MS;

/**
 * The session table's key for a token: the same SHA-256 hex as the emailed
 * tokens (see token-hash.ts). Migration 0040 hashed the tokens that existed
 * before the same way, so nobody was signed out.
 */
export const hashSessionToken = hashToken;

// ─────────────────────────────────────────────────────────────────────────────
// createSession(userId)
//
// Called after a successful login. Creates a new row in the session table and
// returns the random token (32 random bytes, base64url) that should be stored
// in the browser cookie.
// ─────────────────────────────────────────────────────────────────────────────

export async function createSession(userId: number): Promise<string> {
	const token = crypto.randomBytes(32).toString('base64url');

	const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

	await db.insert(session).values({ id: hashSessionToken(token), userId, expiresAt });

	return token;
}

/** Stores a session token from createSession() in the browser. */
export function setSessionCookie(cookies: Cookies, token: string): void {
	cookies.set(SESSION_COOKIE_NAME, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: SECURE_COOKIE,
		maxAge: SESSION_DURATION_MS / 1000
	});
}

// ─────────────────────────────────────────────────────────────────────────────
// validateSession(token)
//
// Called on every request by hooks.server.ts. Looks up the token in the
// session table. Returns the userId if the session exists and has not expired,
// or null if it is invalid/expired. `renewed` is true when the expiry was just
// pushed back, so the caller sets the cookie again with a fresh max-age.
//
// Expired sessions are deleted immediately when discovered — this keeps the
// session table from accumulating stale rows over time.
// ─────────────────────────────────────────────────────────────────────────────

export async function validateSession(
	token: string
): Promise<{ userId: number; renewed: boolean } | null> {
	const id = hashSessionToken(token);
	const [row] = await db.select().from(session).where(eq(session.id, id));

	if (!row) {
		// Token not found in the database — invalid or already deleted.
		return null;
	}

	const now = Date.now();
	if (row.expiresAt.getTime() < now) {
		// Token exists but has passed its expiry date — delete and reject.
		await db.delete(session).where(eq(session.id, id));
		return null;
	}

	if (row.expiresAt.getTime() - now < SESSION_RENEW_BELOW_MS) {
		await db
			.update(session)
			.set({ expiresAt: new Date(now + SESSION_DURATION_MS) })
			.where(eq(session.id, id));
		return { userId: row.userId, renewed: true };
	}

	return { userId: row.userId, renewed: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// deleteSession(token)
//
// Called on logout. Removes the session row from the database so the token
// is immediately invalid — even if the browser still has the cookie.
// ─────────────────────────────────────────────────────────────────────────────

export async function deleteSession(token: string): Promise<void> {
	await db.delete(session).where(eq(session.id, hashSessionToken(token)));
}

// ─────────────────────────────────────────────────────────────────────────────
// cleanExpiredSessions()
//
// Bulk-deletes all sessions past their expiry date. Called by the periodic
// cleanup in hooks.server.ts to keep the table from growing without bound.
// ─────────────────────────────────────────────────────────────────────────────

export async function cleanExpiredSessions(): Promise<number> {
	const result = await db.delete(session).where(lt(session.expiresAt, new Date()));
	return result.count;
}

/**
 * Deletes expired password-reset and email-verification tokens, used or not.
 * Returns how many rows went.
 */
export async function cleanExpiredTokens(): Promise<number> {
	const now = new Date();
	const resets = await db.delete(passwordResetToken).where(lt(passwordResetToken.expiresAt, now));
	const verifications = await db
		.delete(emailVerificationToken)
		.where(lt(emailVerificationToken.expiresAt, now));
	return resets.count + verifications.count;
}
