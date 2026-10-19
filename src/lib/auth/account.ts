// Account changes that need the signed-in user to prove who they are.
//
// A session alone is not enough to change the email address or password, or
// to delete the account: whoever holds a stolen session could otherwise point
// the email at themselves and take the account over through "forgot password".

import { error } from '@sveltejs/kit';
import bcrypt from 'bcryptjs';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/db';
import { emailVerificationToken, passwordResetToken, user } from '$lib/db/schema';
import { isRateLimited } from '$lib/auth/rate-limit';
import { PASSWORD_CHECK_RATE_LIMIT } from '$lib/auth/rate-limit-config';

/**
 * Throws 403 unless `password` is the user's current password, or 429 once
 * they have made too many attempts.
 */
export async function verifyCurrentPassword(
	userId: number,
	password: string,
	wrongPasswordMessage = 'Password is incorrect'
): Promise<void> {
	if (await isRateLimited(String(userId), PASSWORD_CHECK_RATE_LIMIT)) {
		throw error(429, 'Too many password attempts. Please try again in 15 minutes.');
	}

	const [row] = await db
		.select({ passwordHash: user.passwordHash })
		.from(user)
		.where(eq(user.id, userId));
	if (!row) throw error(500, 'User not found');

	if (!(await bcrypt.compare(password, row.passwordHash))) {
		throw error(403, wrongPasswordMessage);
	}
}

/**
 * Sets a new email address, which then needs verifying again. Links already
 * sent to the old address (verification and password reset) stop working.
 * Returns false when the address is unchanged.
 */
export async function changeEmail(userId: number, email: string): Promise<boolean> {
	return db.transaction(async (tx) => {
		const [current] = await tx.select({ email: user.email }).from(user).where(eq(user.id, userId));
		if (!current || current.email === email) return false;

		await tx.update(user).set({ email, emailVerified: false }).where(eq(user.id, userId));
		await tx
			.delete(emailVerificationToken)
			.where(and(eq(emailVerificationToken.userId, userId), isNull(emailVerificationToken.usedAt)));
		await tx
			.delete(passwordResetToken)
			.where(and(eq(passwordResetToken.userId, userId), isNull(passwordResetToken.usedAt)));
		return true;
	});
}
