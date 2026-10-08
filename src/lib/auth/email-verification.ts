// Email verification token creation and validation.
//
// Generates a cryptographically random token, SHA-256-hashes it, stores
// the hash in the database, and sends the plain token to the user via
// the Loops transactional email API. On verification, the token is
// compared against the stored hash and the user's emailVerified flag
// is set to true.
//
// Follows the same hashed-token pattern as passwordResetToken.

import crypto from 'crypto';
import { db } from '$lib/db';
import { emailVerificationToken, user } from '$lib/db/schema';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { hashToken } from '$lib/auth/token-hash';
import { sendVerificationEmail } from '$lib/loops';
import { log } from '$lib/server/log';

const TOKEN_EXPIRY_HOURS = 24;
const ORIGIN = process.env.ORIGIN ?? 'http://localhost:3000';

// ─────────────────────────────────────────────────────────────────────────────
// createAndSendVerification(userId, email)
//
// Generates a new verification token, stores the SHA-256 hash in the database,
// and sends the plain token to the user's email via Loops.
//
// Deletes any existing unused tokens for this user first to prevent
// accumulation from multiple resends.
// ─────────────────────────────────────────────────────────────────────────────

export async function createAndSendVerification(userId: number, email: string): Promise<void> {
	// Delete any existing unused tokens for this user.
	await db
		.delete(emailVerificationToken)
		.where(and(eq(emailVerificationToken.userId, userId), isNull(emailVerificationToken.usedAt)));

	// Generate a 32-byte random token, encoded as URL-safe base64.
	const rawToken = crypto.randomBytes(32).toString('base64url');

	// Hash the token before storing it — the plain token only exists in the email link.
	const tokenHash = hashToken(rawToken);

	const expiresAt = new Date();
	expiresAt.setHours(expiresAt.getHours() + TOKEN_EXPIRY_HOURS);

	await db.insert(emailVerificationToken).values({
		userId,
		tokenHash,
		expiresAt,
		createdAt: new Date()
	});

	const verifyUrl = `${ORIGIN}/api/auth/verify-email?token=${rawToken}`;
	await sendVerificationEmail(email, verifyUrl);
}

// ─────────────────────────────────────────────────────────────────────────────
// verifyEmailToken(token)
//
// Hashes the provided token and atomically consumes the matching unexpired,
// unused row (single indexed lookup), then sets the user's emailVerified
// flag to true. The atomic UPDATE ... RETURNING ensures a token can only be
// redeemed once even under concurrent requests.
//
// Returns { success: true, userId } on success, or { success: false, reason }
// on failure.
// ─────────────────────────────────────────────────────────────────────────────

type VerifyResult = { success: true; userId: number } | { success: false; reason: string };

export async function verifyEmailToken(token: string): Promise<VerifyResult> {
	const [consumed] = await db
		.update(emailVerificationToken)
		.set({ usedAt: new Date() })
		.where(
			and(
				eq(emailVerificationToken.tokenHash, hashToken(token)),
				isNull(emailVerificationToken.usedAt),
				gt(emailVerificationToken.expiresAt, new Date())
			)
		)
		.returning({ userId: emailVerificationToken.userId });

	if (consumed) {
		await db.update(user).set({ emailVerified: true }).where(eq(user.id, consumed.userId));

		try {
			const { activateReferralDiscount } = await import('$lib/stripe/referral.server');
			await activateReferralDiscount(consumed.userId);
		} catch (e) {
			log.error('Referral discount activation failed', { userId: consumed.userId, err: e });
		}

		return { success: true, userId: consumed.userId };
	}

	return { success: false, reason: 'invalid-or-expired' };
}
