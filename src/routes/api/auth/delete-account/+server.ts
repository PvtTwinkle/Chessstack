// DELETE /api/auth/delete-account — Self-service account deletion.
//
// Requires the user's current password in the request body. Cancels any
// active Stripe subscription, cascade-deletes all user data, clears the
// session cookie, and returns success so the client can redirect.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import bcrypt from 'bcryptjs';
import { db } from '$lib/db';
import {
	user,
	session,
	userSettings,
	repertoire,
	userMove,
	userRepertoireMove,
	reviewedGame,
	drillSession,
	puzzleAttempt,
	importedGame,
	subscription,
	passwordResetToken
} from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { SESSION_COOKIE_NAME, SECURE_COOKIE } from '$lib/auth';
import { getStripe } from '$lib/stripe/client';
import { requireAuth } from '$lib/server/api-helpers';
import { parseBody } from '$lib/server/validation';
import { deleteAccountSchema } from '$lib/server/schemas/account';

export const DELETE: RequestHandler = async ({ locals, request, cookies }) => {
	const authedUser = requireAuth(locals);

	const { password } = await parseBody(request, deleteAccountSchema);

	// Verify the password before doing anything destructive.
	const [currentUser] = await db
		.select({ passwordHash: user.passwordHash, stripeCustomerId: user.stripeCustomerId })
		.from(user)
		.where(eq(user.id, authedUser.id));

	if (!currentUser) throw error(500, 'User not found');

	if (!(await bcrypt.compare(password, currentUser.passwordHash))) {
		throw error(403, 'Password is incorrect');
	}

	// Cancel Stripe subscription if one exists.
	const [sub] = await db
		.select({ stripeSubscriptionId: subscription.stripeSubscriptionId })
		.from(subscription)
		.where(eq(subscription.userId, authedUser.id));

	if (sub?.stripeSubscriptionId) {
		const stripe = getStripe();
		if (stripe) {
			try {
				await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
			} catch {
				// If the subscription is already cancelled or invalid in Stripe,
				// we still proceed with account deletion.
			}
		}
	}

	// Cascade-delete all user data in FK-safe order (children before parents).
	const userId = authedUser.id;
	await db.transaction(async (tx) => {
		await tx.delete(passwordResetToken).where(eq(passwordResetToken.userId, userId));
		await tx.delete(subscription).where(eq(subscription.userId, userId));
		await tx.delete(session).where(eq(session.userId, userId));
		await tx.delete(puzzleAttempt).where(eq(puzzleAttempt.userId, userId));
		await tx.delete(drillSession).where(eq(drillSession.userId, userId));
		await tx.delete(importedGame).where(eq(importedGame.userId, userId));
		await tx.delete(reviewedGame).where(eq(reviewedGame.userId, userId));
		await tx.delete(userRepertoireMove).where(eq(userRepertoireMove.userId, userId));
		await tx.delete(userMove).where(eq(userMove.userId, userId));
		await tx.delete(repertoire).where(eq(repertoire.userId, userId));
		await tx.delete(userSettings).where(eq(userSettings.userId, userId));
		await tx.delete(user).where(eq(user.id, userId));
	});

	// Clear the session cookie so the browser forgets the (now-deleted) token.
	cookies.delete(SESSION_COOKIE_NAME, { path: '/', secure: SECURE_COOKIE });

	return json({ success: true });
};
