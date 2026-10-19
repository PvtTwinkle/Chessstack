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
//
// Stripe doesn't guarantee delivery order and retries failed deliveries, so
// the checkout and update handlers fetch the subscription's current state
// from Stripe rather than trusting the event payload. A late or repeated
// event then writes the same, current state instead of rolling it back.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { user, subscription } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { getStripe, STRIPE_WEBHOOK_SECRET } from '$lib/stripe/client';
import type Stripe from 'stripe';
import { mapStripeStatus } from '$lib/stripe/status';
import { log } from '$lib/server/log';

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
		log.warn('Stripe webhook with an invalid signature', { reason: 'invalid signature' });
		return new Response('Invalid signature', { status: 400 });
	}

	switch (event.type) {
		case 'checkout.session.completed':
			await handleCheckoutCompleted(stripe, event.data.object as Stripe.Checkout.Session);
			break;

		case 'customer.subscription.updated':
			await handleSubscriptionUpdated(stripe, event.data.object as Stripe.Subscription);
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
	if (!userId) {
		log.warn('Stripe checkout without a user id', { stripeSessionId: session.id });
		return;
	}

	const stripeCustomerId =
		typeof session.customer === 'string' ? session.customer : session.customer?.id;
	const stripeSubscriptionId =
		typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;

	if (!stripeSubscriptionId) {
		log.warn('Stripe checkout without a subscription', { stripeSessionId: session.id, userId });
		return;
	}

	// The account may have been deleted since checkout started. Inserting its
	// subscription row would fail on the foreign key and Stripe would retry
	// the event for days, so skip it.
	const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.id, userId));
	if (!owner) {
		log.warn('Stripe checkout for a deleted user', { stripeSessionId: session.id, userId });
		return;
	}

	// Save the Stripe customer ID on the user record.
	if (stripeCustomerId) {
		await db.update(user).set({ stripeCustomerId }).where(eq(user.id, userId));
	}

	// The subscription's current state, which may already be canceled if this
	// delivery is late.
	const stripeSub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
	const { tier, status } = mapStripeStatus(stripeSub.status);

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
				tier,
				status,
				stripeSubscriptionId,
				stripePriceId: priceId,
				currentPeriodEnd: periodEnd,
				cancelAtPeriodEnd: isCancelling(stripeSub),
				...(referralDiscountUsedAt ? { referralDiscountUsedAt } : {}),
				updatedAt: now
			})
			.where(eq(subscription.userId, userId));
	} else {
		await db.insert(subscription).values({
			userId,
			tier,
			status,
			stripeSubscriptionId,
			stripePriceId: priceId,
			currentPeriodEnd: periodEnd,
			cancelAtPeriodEnd: isCancelling(stripeSub),
			referralDiscountUsedAt: referralDiscountUsedAt ?? null,
			createdAt: now,
			updatedAt: now
		});
	}
}

async function handleSubscriptionUpdated(stripe: Stripe, eventSub: Stripe.Subscription) {
	const stripeSubId = eventSub.id;
	const stripeSub = await stripe.subscriptions.retrieve(stripeSubId);

	const { tier, status } = mapStripeStatus(stripeSub.status);

	// In Stripe API v2025+, current_period_end lives on subscription items.
	const firstItem = stripeSub.items.data[0];
	const periodEnd = firstItem ? new Date(firstItem.current_period_end * 1000) : null;
	const priceId = firstItem?.price?.id ?? null;

	// `tier` only tracks Stripe; an admin gift lives in giftExpiry and is
	// combined with it when the user's access is worked out.
	const updated = await db
		.update(subscription)
		.set({
			tier,
			status,
			stripePriceId: priceId,
			currentPeriodEnd: periodEnd,
			cancelAtPeriodEnd: isCancelling(stripeSub),
			updatedAt: new Date()
		})
		.where(eq(subscription.stripeSubscriptionId, stripeSubId))
		.returning({ id: subscription.id });
	if (updated.length === 0) warnUnknownSubscription('customer.subscription.updated', stripeSubId);
}

// Set to cancel, either at the end of the period or on a chosen date.
function isCancelling(stripeSub: Stripe.Subscription): boolean {
	return stripeSub.cancel_at_period_end || stripeSub.cancel_at !== null;
}

async function handleSubscriptionDeleted(stripeSub: Stripe.Subscription) {
	// An admin gift, if any, keeps paid access through giftExpiry.
	const updated = await db
		.update(subscription)
		.set({
			tier: 'free',
			status: 'canceled',
			cancelAtPeriodEnd: false,
			updatedAt: new Date()
		})
		.where(eq(subscription.stripeSubscriptionId, stripeSub.id))
		.returning({ id: subscription.id });
	if (updated.length === 0) warnUnknownSubscription('customer.subscription.deleted', stripeSub.id);
}

// Expected after an account is deleted, or for a subscription replaced by a
// newer one, but worth seeing in the logs if it keeps happening.
function warnUnknownSubscription(eventType: string, stripeSubscriptionId: string) {
	log.warn('Stripe event for an unknown subscription', { eventType, stripeSubscriptionId });
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
