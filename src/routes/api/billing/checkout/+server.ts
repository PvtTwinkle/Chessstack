// POST /api/billing/checkout — create a Stripe Checkout session for upgrading.
//
// Returns { url } pointing to the Stripe-hosted checkout page.
// The frontend redirects the browser there.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { user, subscription } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import {
	getStripe,
	STRIPE_PRICE_ID_MONTHLY,
	STRIPE_PRICE_ID_ANNUAL,
	STRIPE_REFERRAL_COUPON_ID
} from '$lib/stripe/client';
import type Stripe from 'stripe';
import { requireAuth } from '$lib/server/api-helpers';
import { parseBody } from '$lib/server/validation';
import { checkoutSchema } from '$lib/server/schemas/billing';

const ORIGIN = process.env.ORIGIN ?? 'http://localhost:3000';

const PRICE_IDS = {
	monthly: STRIPE_PRICE_ID_MONTHLY,
	annual: STRIPE_PRICE_ID_ANNUAL
};

export const POST: RequestHandler = async ({ locals, request }) => {
	const authedUser = requireAuth(locals);

	const stripe = getStripe();
	if (!stripe || !STRIPE_PRICE_ID_MONTHLY || !STRIPE_PRICE_ID_ANNUAL) {
		throw error(503, 'Billing is not configured');
	}

	const { plan } = await parseBody(request, checkoutSchema);
	const priceId = PRICE_IDS[plan];

	// Check if the user already has an active paid subscription.
	const [existingSub] = await db
		.select({
			tier: subscription.tier,
			status: subscription.status,
			referralDiscountActive: subscription.referralDiscountActive,
			referralDiscountUsedAt: subscription.referralDiscountUsedAt
		})
		.from(subscription)
		.where(eq(subscription.userId, authedUser.id));

	if (existingSub?.tier === 'paid' && existingSub.status === 'active') {
		throw error(400, 'You already have an active subscription');
	}

	// Look up the user's Stripe customer ID (if they've checked out before).
	const [foundUser] = await db
		.select({ email: user.email, stripeCustomerId: user.stripeCustomerId })
		.from(user)
		.where(eq(user.id, authedUser.id));

	// Build the checkout session parameters.
	const params: Stripe.Checkout.SessionCreateParams = {
		mode: 'subscription',
		line_items: [{ price: priceId, quantity: 1 }],
		success_url: `${ORIGIN}/settings?checkout=success`,
		cancel_url: `${ORIGIN}/settings?checkout=cancel`,
		client_reference_id: String(authedUser.id)
	};

	if (foundUser?.stripeCustomerId) {
		// Returning customer — attach to existing Stripe customer.
		params.customer = foundUser.stripeCustomerId;
	} else if (foundUser?.email) {
		// New customer — pre-fill their email on the checkout page.
		params.customer_email = foundUser.email;
	}

	// Apply the referral coupon (50% off, once) if the user has an unused referral discount
	// and is subscribing to the annual plan. The metadata flag tells the webhook to mark
	// the discount as used once checkout completes, so it can't be reused after a cancel.
	if (
		plan === 'annual' &&
		existingSub?.referralDiscountActive &&
		!existingSub.referralDiscountUsedAt &&
		STRIPE_REFERRAL_COUPON_ID
	) {
		params.discounts = [{ coupon: STRIPE_REFERRAL_COUPON_ID }];
		params.metadata = { referral_discount: '1' };
	}

	const session = await stripe.checkout.sessions.create(params);

	return json({ url: session.url });
};
