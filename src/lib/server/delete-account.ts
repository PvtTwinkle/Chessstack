// Deletes a user account and everything in it, for self-service deletion
// (/api/auth/delete-account) and for admins (/api/admin/users/[id]).
//
// Every table that belongs to a user references "user" with ON DELETE CASCADE
// (delete-account.db.test.ts checks the catalog), so deleting the user row
// deletes the rest in the same statement and a new table can't be forgotten.

import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { subscription, user } from '$lib/db/schema';
import { cancelStripeSubscription } from '$lib/stripe/cancel.server';
import { deleteContact } from '$lib/loops';
import { log } from '$lib/server/log';
import type { Transaction } from '$lib/server/repertoire-moves';

/** Thrown when the Stripe subscription couldn't be cancelled; nothing was deleted. */
export class SubscriptionNotCancelledError extends Error {
	constructor(cause: unknown) {
		super('Stripe subscription could not be cancelled', { cause });
		this.name = 'SubscriptionNotCancelledError';
	}
}

/**
 * Cancels the user's Stripe subscription, then deletes the user and all their
 * data in one transaction, running `alsoInTransaction` (an audit entry) in it.
 * The subscription goes first: if it can't be cancelled the account is kept,
 * so nobody is left paying for an account that no longer exists. The user's
 * Loops contact is deleted afterwards, best-effort.
 */
export async function deleteUserAccount(
	userId: number,
	alsoInTransaction?: (tx: Transaction) => Promise<void>
): Promise<void> {
	const [account] = await db
		.select({
			username: user.username,
			email: user.email,
			stripeSubscriptionId: subscription.stripeSubscriptionId
		})
		.from(user)
		.leftJoin(subscription, eq(subscription.userId, user.id))
		.where(eq(user.id, userId));
	if (!account) return;

	if (account.stripeSubscriptionId) {
		try {
			await cancelStripeSubscription(account.stripeSubscriptionId);
		} catch (err) {
			throw new SubscriptionNotCancelledError(err);
		}
	}

	await db.transaction(async (tx) => {
		await alsoInTransaction?.(tx);
		await tx.delete(user).where(eq(user.id, userId));
	});

	// Only accounts with an email ever got a contact (see register).
	if (account.email) {
		try {
			await deleteContact(account.username);
		} catch (err) {
			log.warn('Failed to delete Loops contact', {
				tag: 'LOOPS_CONTACT_FAILURE',
				userId,
				reason: err instanceof Error ? err.message : String(err)
			});
		}
	}
}
