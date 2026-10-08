// Maps a Stripe subscription status onto our local tier/status pair.
//
// Only statuses that represent a paying (or grace-period) customer grant paid
// access; everything else — canceled, unpaid, incomplete, incomplete_expired,
// paused, and any status Stripe adds in future — falls back to free.

import type Stripe from 'stripe';

export type LocalTier = 'free' | 'paid';
export type LocalStatus = 'active' | 'past_due' | 'canceled';

export function mapStripeStatus(stripeStatus: Stripe.Subscription.Status | string): {
	tier: LocalTier;
	status: LocalStatus;
} {
	if (stripeStatus === 'active' || stripeStatus === 'trialing') {
		return { tier: 'paid', status: 'active' };
	}
	if (stripeStatus === 'past_due') {
		return { tier: 'paid', status: 'past_due' }; // keep access during grace period
	}
	return { tier: 'free', status: 'canceled' };
}
