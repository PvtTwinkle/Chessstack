// POST /api/billing/portal — create a Stripe Customer Portal session.
//
// Returns { url } pointing to the Stripe-hosted portal where users can
// manage their subscription, update payment methods, and view invoices.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { user } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import Stripe from 'stripe';
import { getStripe } from '$lib/stripe/client';
import { log } from '$lib/server/log';
import { requireAuth } from '$lib/server/api-helpers';
import { ORIGIN } from '$lib/server/origin';

export const POST: RequestHandler = async ({ locals }) => {
	const authUser = requireAuth(locals);

	const stripe = getStripe();
	if (!stripe) {
		throw error(503, 'Billing is not configured');
	}

	// The user must have a Stripe customer ID (set during checkout).
	const [foundUser] = await db
		.select({ stripeCustomerId: user.stripeCustomerId })
		.from(user)
		.where(eq(user.id, authUser.id));

	if (!foundUser?.stripeCustomerId) {
		throw error(400, 'No billing account found');
	}

	try {
		const session = await stripe.billingPortal.sessions.create({
			customer: foundUser.stripeCustomerId,
			return_url: `${ORIGIN}/settings`
		});
		return json({ url: session.url });
	} catch (err) {
		if (!(err instanceof Stripe.errors.StripeError)) throw err;
		log.warn('Stripe billing portal failed', { userId: authUser.id, reason: err.message });
		throw error(502, 'Billing is temporarily unavailable. Please try again in a few minutes.');
	}
};
