// Cancels a user's Stripe subscription before their account is deleted.
//
// Deleting the account removes the only record linking the subscription to a
// person, so a subscription left running would keep charging someone who has
// no account. This throws unless the subscription is confirmed gone; callers
// must not delete anything when it does.

import { getStripe } from '$lib/stripe/client';
import { log } from '$lib/server/log';

// Statuses after which Stripe will not charge again.
const ENDED_STATUSES = new Set(['canceled', 'incomplete_expired']);

export async function cancelStripeSubscription(subscriptionId: string): Promise<void> {
	const stripe = getStripe();
	if (!stripe) {
		// Billing is switched off on this instance, so it cannot be reached and
		// will not deliver webhooks either. Nothing more can be done from here.
		log.warn('Stripe is not configured; subscription left as is', { subscriptionId });
		return;
	}

	try {
		await stripe.subscriptions.cancel(subscriptionId);
		return;
	} catch (cancelError) {
		// Already deleted in Stripe (or from another Stripe account).
		if ((cancelError as { code?: string }).code === 'resource_missing') return;

		// Cancelling an already-canceled subscription is an error too; check
		// whether that is all this was before giving up.
		try {
			const sub = await stripe.subscriptions.retrieve(subscriptionId);
			if (ENDED_STATUSES.has(sub.status)) return;
		} catch {
			// Report the original failure below.
		}
		throw cancelError;
	}
}
