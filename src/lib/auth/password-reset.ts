// Password reset token creation and validation.
//
// Generates a cryptographically random token, SHA-256-hashes it, stores
// the hash in the database, and sends the plain token to the user via
// the Loops transactional email API. On validation, the token is
// compared against the stored hash and consumed (marked as used).
//
// Follows the same hashed-token pattern as email-verification.ts.

import crypto from 'crypto';
import { db } from '$lib/db';
import { passwordResetToken } from '$lib/db/schema';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { hashToken } from '$lib/auth/token-hash';
import { sendPasswordResetEmail } from '$lib/loops';

const TOKEN_EXPIRY_HOURS = 1;
const ORIGIN = process.env.ORIGIN ?? 'http://localhost:3000';

// ─────────────────────────────────────────────────────────────────────────────
// createAndSendPasswordReset(userId, email)
//
// Generates a new reset token, stores the SHA-256 hash in the database,
// and sends the plain token to the user's email via Loops.
//
// Deletes any existing unused tokens for this user first to prevent
// accumulation from multiple requests.
// ─────────────────────────────────────────────────────────────────────────────

export async function createAndSendPasswordReset(userId: number, email: string): Promise<void> {
	// Delete any existing unused tokens for this user.
	await db
		.delete(passwordResetToken)
		.where(and(eq(passwordResetToken.userId, userId), isNull(passwordResetToken.usedAt)));

	// Generate a 32-byte random token, encoded as URL-safe base64.
	const rawToken = crypto.randomBytes(32).toString('base64url');

	// Hash the token before storing it — the plain token only exists in the email link.
	const tokenHash = hashToken(rawToken);

	const expiresAt = new Date();
	expiresAt.setHours(expiresAt.getHours() + TOKEN_EXPIRY_HOURS);

	await db.insert(passwordResetToken).values({
		userId,
		tokenHash,
		expiresAt,
		createdAt: new Date()
	});

	const resetUrl = `${ORIGIN}/reset-password?token=${rawToken}`;
	await sendPasswordResetEmail(email, resetUrl);
}

// ─────────────────────────────────────────────────────────────────────────────
// validatePasswordResetToken(token)
//
// Hashes the provided token and atomically consumes (marks as used) the
// matching unexpired, unused row with a single indexed lookup. The atomic
// UPDATE ... RETURNING ensures a token can only be redeemed once even under
// concurrent requests.
//
// Returns { success: true, userId } on success, or { success: false, reason }
// on failure.
// ─────────────────────────────────────────────────────────────────────────────

type ValidateResult = { success: true; userId: number } | { success: false; reason: string };

export async function validatePasswordResetToken(token: string): Promise<ValidateResult> {
	const [consumed] = await db
		.update(passwordResetToken)
		.set({ usedAt: new Date() })
		.where(
			and(
				eq(passwordResetToken.tokenHash, hashToken(token)),
				isNull(passwordResetToken.usedAt),
				gt(passwordResetToken.expiresAt, new Date())
			)
		)
		.returning({ userId: passwordResetToken.userId });

	if (consumed) {
		return { success: true, userId: consumed.userId };
	}

	return { success: false, reason: 'invalid-or-expired' };
}
