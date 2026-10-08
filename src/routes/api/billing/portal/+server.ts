// POST /api/billing/portal — create a Stripe Customer Portal session.
//
// Returns { url } pointing to the Stripe-hosted portal where users can
// manage their subscription, update payment methods, and view invoices.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { user } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { getStripe } from '$lib/stripe/client';
import { requireAuth } from '$lib/server/api-helpers';

const ORIGIN = process.env.ORIGIN ?? 'http://localhost:3000';

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

	const session = await stripe.billingPortal.sessions.create({
		customer: foundUser.stripeCustomerId,
		return_url: `${ORIGIN}/settings`
	});

	return json({ url: session.url });
};
