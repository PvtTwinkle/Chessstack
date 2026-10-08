// POST /api/billing/webhook — Stripe webhook handler.
//
// This endpoint is PUBLIC (no session auth). Authentication is done by
// verifying the Stripe webhook signature on the raw request body.
//
// Keeps the local `subscription` table in sync with Stripe events:
//   - checkout.session.completed  → create/update subscription, set stripeCustomerId
//   - customer.subscription.updated → sync status, period end, cancellation flag
//   - customer.subscription.deleted → revert to free tier
//   - invoice.payment_failed       → mark subscription as past_due

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { user, subscription } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { getStripe, STRIPE_WEBHOOK_SECRET } from '$lib/stripe/client';
import type Stripe from 'stripe';
import { mapStripeStatus } from '$lib/stripe/status';

export const POST: RequestHandler = async ({ request }) => {
	const stripe = getStripe();
	if (!stripe || !STRIPE_WEBHOOK_SECRET) {
		return new Response('Webhook not configured', { status: 503 });
	}

	// Verify the webhook signature using the raw body.
	const rawBody = await request.text();
	const signature = request.headers.get('stripe-signature');
	if (!signature) {
		return new Response('Missing stripe-signature header', { status: 400 });
	}

	let event: Stripe.Event;
	try {
		event = stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
	} catch {
		return new Response('Invalid signature', { status: 400 });
	}

	switch (event.type) {
		case 'checkout.session.completed':
			await handleCheckoutCompleted(stripe, event.data.object as Stripe.Checkout.Session);
			break;

		case 'customer.subscription.updated':
			await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
			break;

		case 'customer.subscription.deleted':
			await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
			break;

		case 'invoice.payment_failed':
			await handlePaymentFailed(event.data.object as Stripe.Invoice);
			break;
	}

	// Always return 200 so Stripe does not retry (even for unhandled event types).
	return json({ received: true });
};

// ─────────────────────────────────────────────────────────────────────────────
// Event handlers
// ─────────────────────────────────────────────────────────────────────────────

async function handleCheckoutCompleted(stripe: Stripe, session: Stripe.Checkout.Session) {
	const userId = session.client_reference_id ? parseInt(session.client_reference_id, 10) : null;
	if (!userId) return;

	const stripeCustomerId =
		typeof session.customer === 'string' ? session.customer : session.customer?.id;
	const stripeSubscriptionId =
		typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;

	if (!stripeSubscriptionId) return;

	// Save the Stripe customer ID on the user record.
	if (stripeCustomerId) {
		await db.update(user).set({ stripeCustomerId }).where(eq(user.id, userId));
	}

	// Fetch the full subscription from Stripe to get period details.
	const stripeSub = await stripe.subscriptions.retrieve(stripeSubscriptionId);

	const now = new Date();
	// In Stripe API v2025+, current_period_end lives on subscription items.
	const firstItem = stripeSub.items.data[0];
	const periodEnd = firstItem ? new Date(firstItem.current_period_end * 1000) : now;
	const priceId = firstItem?.price?.id ?? null;

	// Checkout set this flag when it applied the single-use referral coupon.
	const referralDiscountUsedAt = session.metadata?.referral_discount === '1' ? now : undefined;

	// Upsert the subscription row.
	const [existing] = await db
		.select({ id: subscription.id })
		.from(subscription)
		.where(eq(subscription.userId, userId));

	if (existing) {
		await db
			.update(subscription)
			.set({
				tier: 'paid',
				status: 'active',
				stripeSubscriptionId,
				stripePriceId: priceId,
				currentPeriodEnd: periodEnd,
				cancelAtPeriodEnd: false,
				...(referralDiscountUsedAt ? { referralDiscountUsedAt } : {}),
				updatedAt: now
			})
			.where(eq(subscription.userId, userId));
	} else {
		await db.insert(subscription).values({
			userId,
			tier: 'paid',
			status: 'active',
			stripeSubscriptionId,
			stripePriceId: priceId,
			currentPeriodEnd: periodEnd,
			cancelAtPeriodEnd: false,
			referralDiscountUsedAt: referralDiscountUsedAt ?? null,
			createdAt: now,
			updatedAt: now
		});
	}
}

async function handleSubscriptionUpdated(stripeSub: Stripe.Subscription) {
	const stripeSubId = stripeSub.id;

	const { tier, status } = mapStripeStatus(stripeSub.status);

	// In Stripe API v2025+, current_period_end lives on subscription items.
	const firstItem = stripeSub.items.data[0];
	const periodEnd = firstItem ? new Date(firstItem.current_period_end * 1000) : null;
	const priceId = firstItem?.price?.id ?? null;

	// If an active gift exists, don't overwrite the tier — the admin
	// intentionally granted paid access independent of Stripe. We still update
	// status and billing metadata so admins can see the Stripe-side state.
	const [existing] = await db
		.select({ giftExpiry: subscription.giftExpiry })
		.from(subscription)
		.where(eq(subscription.stripeSubscriptionId, stripeSubId));

	const giftActive = existing?.giftExpiry != null && existing.giftExpiry > new Date();

	await db
		.update(subscription)
		.set({
			...(giftActive ? {} : { tier }),
			status,
			stripePriceId: priceId,
			currentPeriodEnd: periodEnd,
			cancelAtPeriodEnd: stripeSub.cancel_at_period_end || stripeSub.cancel_at !== null,
			updatedAt: new Date()
		})
		.where(eq(subscription.stripeSubscriptionId, stripeSubId));
}

async function handleSubscriptionDeleted(stripeSub: Stripe.Subscription) {
	// Don't downgrade tier if an active gift exists.
	const [existing] = await db
		.select({ giftExpiry: subscription.giftExpiry })
		.from(subscription)
		.where(eq(subscription.stripeSubscriptionId, stripeSub.id));

	const giftActive = existing?.giftExpiry != null && existing.giftExpiry > new Date();

	await db
		.update(subscription)
		.set({
			...(giftActive ? {} : { tier: 'free' }),
			status: 'canceled',
			cancelAtPeriodEnd: false,
			updatedAt: new Date()
		})
		.where(eq(subscription.stripeSubscriptionId, stripeSub.id));
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
	// In Stripe API v2025+, the subscription is nested under parent.subscription_details.
	const subDetail = invoice.parent?.subscription_details?.subscription;
	const stripeSubId = typeof subDetail === 'string' ? subDetail : subDetail?.id;

	if (!stripeSubId) return;

	await db
		.update(subscription)
		.set({
			status: 'past_due',
			updatedAt: new Date()
		})
		.where(eq(subscription.stripeSubscriptionId, stripeSubId));
}
