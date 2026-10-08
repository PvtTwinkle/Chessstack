// Integration tests for the billing flow: referral activation, checkout
// session creation and the Stripe webhook. The Stripe API client is mocked,
// but webhook signatures are generated and verified with the real SDK.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { subscription, user } from '$lib/db/schema';
import { resetDb, createUser, createSubscription } from '$lib/test/db-helpers';

const stripeApi = vi.hoisted(() => ({
	subscriptions: { retrieve: vi.fn(), update: vi.fn() },
	checkout: { sessions: { create: vi.fn() } }
}));

vi.mock('$lib/stripe/client', async () => {
	const { default: RealStripe } = await import('stripe');
	const real = new RealStripe('sk_test_dummy');
	return {
		STRIPE_PRICE_ID_MONTHLY: 'price_monthly',
		STRIPE_PRICE_ID_ANNUAL: 'price_annual',
		STRIPE_WEBHOOK_SECRET: 'whsec_test',
		STRIPE_REFERRAL_COUPON_ID: 'coupon_referral',
		getStripe: () => ({ ...stripeApi, webhooks: real.webhooks })
	};
});

const { activateReferralDiscount } = await import('./referral.server');
const { POST: webhookPOST } = await import('../../routes/api/billing/webhook/+server');
const { POST: checkoutPOST } = await import('../../routes/api/billing/checkout/+server');

const signer = new Stripe('sk_test_dummy');

// ── helpers ──────────────────────────────────────────────────────────────────

async function sendWebhook(type: string, object: unknown, secret = 'whsec_test') {
	const payload = JSON.stringify({ id: 'evt_test', object: 'event', type, data: { object } });
	const header = signer.webhooks.generateTestHeaderString({ payload, secret });
	const request = new Request('http://localhost/api/billing/webhook', {
		method: 'POST',
		headers: { 'stripe-signature': header, 'content-type': 'application/json' },
		body: payload
	});
	return webhookPOST({ request } as never);
}

async function startCheckout(userId: number, plan: 'monthly' | 'annual') {
	const request = new Request('http://localhost/api/billing/checkout', {
		method: 'POST',
		body: JSON.stringify({ plan })
	});
	const locals = { user: { id: userId, username: 'u', role: 'user', tier: 'free' } };
	await checkoutPOST({ locals, request } as never);
	return stripeApi.checkout.sessions.create.mock
		.lastCall![0] as Stripe.Checkout.SessionCreateParams;
}

function stripeSubscription(id: string, status: string, priceId = 'price_annual') {
	return {
		id,
		object: 'subscription',
		status,
		cancel_at_period_end: false,
		cancel_at: null,
		items: { data: [{ current_period_end: 1_900_000_000, price: { id: priceId } }] }
	};
}

async function getSub(userId: number) {
	const [row] = await db.select().from(subscription).where(eq(subscription.userId, userId));
	return row;
}

beforeEach(async () => {
	await resetDb();
	vi.clearAllMocks();
	stripeApi.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.test' });
});

// ── referral activation ──────────────────────────────────────────────────────

describe('activateReferralDiscount', () => {
	it('does nothing for a user who was not referred', async () => {
		const u = await createUser();
		await activateReferralDiscount(u);
		expect(await getSub(u)).toBeUndefined();
	});

	it('flags both referee and referrer, and is idempotent', async () => {
		const referrer = await createUser();
		const referee = await createUser({ referredByUserId: referrer });

		await activateReferralDiscount(referee);
		await activateReferralDiscount(referee);

		expect((await getSub(referee)).referralDiscountActive).toBe(true);
		expect((await getSub(referrer)).referralDiscountActive).toBe(true);
		expect(stripeApi.subscriptions.update).not.toHaveBeenCalled();
	});

	it('rewards the referrer only once across multiple referrals', async () => {
		const referrer = await createUser();
		await createSubscription(referrer, {
			tier: 'paid',
			stripeSubscriptionId: 'sub_referrer',
			stripePriceId: 'price_annual'
		});
		const a = await createUser({ referredByUserId: referrer });
		const b = await createUser({ referredByUserId: referrer });

		await activateReferralDiscount(a);
		await activateReferralDiscount(b);

		expect(stripeApi.subscriptions.update).toHaveBeenCalledTimes(1);
		expect((await getSub(b)).referralDiscountActive).toBe(true);
	});

	it('applies the coupon immediately to an annual referrer and marks it used', async () => {
		const referrer = await createUser();
		await createSubscription(referrer, {
			tier: 'paid',
			stripeSubscriptionId: 'sub_referrer',
			stripePriceId: 'price_annual'
		});
		const referee = await createUser({ referredByUserId: referrer });

		await activateReferralDiscount(referee);

		expect(stripeApi.subscriptions.update).toHaveBeenCalledWith('sub_referrer', {
			discounts: [{ coupon: 'coupon_referral' }]
		});
		expect((await getSub(referrer)).referralDiscountUsedAt).toBeInstanceOf(Date);
	});

	it('does not touch a monthly referrer subscription (discount waits for annual checkout)', async () => {
		const referrer = await createUser();
		await createSubscription(referrer, {
			tier: 'paid',
			stripeSubscriptionId: 'sub_referrer',
			stripePriceId: 'price_monthly'
		});
		const referee = await createUser({ referredByUserId: referrer });

		await activateReferralDiscount(referee);

		expect(stripeApi.subscriptions.update).not.toHaveBeenCalled();
		const sub = await getSub(referrer);
		expect(sub.referralDiscountActive).toBe(true);
		expect(sub.referralDiscountUsedAt).toBeNull();
	});
});

// ── checkout ─────────────────────────────────────────────────────────────────

describe('POST /api/billing/checkout', () => {
	it('applies the referral coupon to an annual checkout when unused', async () => {
		const u = await createUser();
		await createSubscription(u, { referralDiscountActive: true });
		const params = await startCheckout(u, 'annual');
		expect(params.discounts).toEqual([{ coupon: 'coupon_referral' }]);
		expect(params.metadata).toEqual({ referral_discount: '1' });
		expect(params.client_reference_id).toBe(String(u));
	});

	it('does not apply the coupon to a monthly checkout', async () => {
		const u = await createUser();
		await createSubscription(u, { referralDiscountActive: true });
		const params = await startCheckout(u, 'monthly');
		expect(params.discounts).toBeUndefined();
	});

	it('does not apply an already-used coupon', async () => {
		const u = await createUser();
		await createSubscription(u, {
			referralDiscountActive: true,
			referralDiscountUsedAt: new Date()
		});
		const params = await startCheckout(u, 'annual');
		expect(params.discounts).toBeUndefined();
		expect(params.metadata).toBeUndefined();
	});

	it('refuses a second subscription for an active paid user', async () => {
		const u = await createUser();
		await createSubscription(u, { tier: 'paid', status: 'active' });
		await expect(startCheckout(u, 'annual')).rejects.toMatchObject({ status: 400 });
	});

	it('rejects an unknown plan', async () => {
		const u = await createUser();
		await expect(startCheckout(u, 'lifetime' as never)).rejects.toMatchObject({ status: 400 });
	});
});

// ── webhook ──────────────────────────────────────────────────────────────────

describe('POST /api/billing/webhook', () => {
	async function completeCheckout(userId: number, metadata: Record<string, string> = {}) {
		stripeApi.subscriptions.retrieve.mockResolvedValue(stripeSubscription('sub_1', 'active'));
		return sendWebhook('checkout.session.completed', {
			id: 'cs_test',
			object: 'checkout.session',
			client_reference_id: String(userId),
			customer: 'cus_1',
			subscription: 'sub_1',
			metadata
		});
	}

	it('rejects an invalid signature', async () => {
		const res = await sendWebhook('customer.subscription.deleted', {}, 'whsec_wrong');
		expect(res.status).toBe(400);
	});

	it('checkout.session.completed upgrades the user and stores the customer id', async () => {
		const u = await createUser();
		const res = await completeCheckout(u);
		expect(res.status).toBe(200);

		const sub = await getSub(u);
		expect(sub).toMatchObject({
			tier: 'paid',
			status: 'active',
			stripeSubscriptionId: 'sub_1',
			stripePriceId: 'price_annual'
		});
		expect(sub.referralDiscountUsedAt).toBeNull();
		const [row] = await db.select().from(user).where(eq(user.id, u));
		expect(row.stripeCustomerId).toBe('cus_1');
	});

	it('checkout.session.completed marks the referral coupon used when it was applied', async () => {
		const u = await createUser();
		await createSubscription(u, { referralDiscountActive: true });
		await completeCheckout(u, { referral_discount: '1' });
		expect((await getSub(u)).referralDiscountUsedAt).toBeInstanceOf(Date);
	});

	it.each([
		['active', 'paid', 'active'],
		['past_due', 'paid', 'past_due'],
		['incomplete_expired', 'free', 'canceled'],
		['paused', 'free', 'canceled'],
		['unpaid', 'free', 'canceled']
	])('customer.subscription.updated %s -> %s/%s', async (stripeStatus, tier, status) => {
		const u = await createUser();
		await createSubscription(u, { tier: 'paid', stripeSubscriptionId: 'sub_1' });
		await sendWebhook('customer.subscription.updated', stripeSubscription('sub_1', stripeStatus));
		expect(await getSub(u)).toMatchObject({ tier, status });
	});

	it('an active admin gift keeps paid access when Stripe cancels', async () => {
		const u = await createUser();
		await createSubscription(u, {
			tier: 'paid',
			stripeSubscriptionId: 'sub_1',
			giftExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
		});
		await sendWebhook('customer.subscription.updated', stripeSubscription('sub_1', 'unpaid'));
		expect(await getSub(u)).toMatchObject({ tier: 'paid', status: 'canceled' });

		await sendWebhook('customer.subscription.deleted', stripeSubscription('sub_1', 'canceled'));
		expect(await getSub(u)).toMatchObject({ tier: 'paid', status: 'canceled' });
	});

	it('customer.subscription.deleted downgrades a user without a gift', async () => {
		const u = await createUser();
		await createSubscription(u, { tier: 'paid', stripeSubscriptionId: 'sub_1' });
		await sendWebhook('customer.subscription.deleted', stripeSubscription('sub_1', 'canceled'));
		expect(await getSub(u)).toMatchObject({ tier: 'free', status: 'canceled' });
	});

	it('invoice.payment_failed marks the subscription past_due', async () => {
		const u = await createUser();
		await createSubscription(u, { tier: 'paid', stripeSubscriptionId: 'sub_1' });
		await sendWebhook('invoice.payment_failed', {
			id: 'in_1',
			object: 'invoice',
			parent: { subscription_details: { subscription: 'sub_1' } }
		});
		expect(await getSub(u)).toMatchObject({ tier: 'paid', status: 'past_due' });
	});
});

// ── end to end ───────────────────────────────────────────────────────────────

describe('referral discount lifecycle', () => {
	it('is applied once and not again after cancel + resubscribe', async () => {
		const referrer = await createUser();
		const referee = await createUser({ referredByUserId: referrer });
		await activateReferralDiscount(referee);

		// First annual checkout gets the coupon...
		const first = await startCheckout(referee, 'annual');
		expect(first.discounts).toEqual([{ coupon: 'coupon_referral' }]);
		stripeApi.subscriptions.retrieve.mockResolvedValue(stripeSubscription('sub_1', 'active'));
		await sendWebhook('checkout.session.completed', {
			id: 'cs_1',
			object: 'checkout.session',
			client_reference_id: String(referee),
			customer: 'cus_1',
			subscription: 'sub_1',
			metadata: first.metadata
		});

		// ...the user cancels...
		await sendWebhook('customer.subscription.deleted', stripeSubscription('sub_1', 'canceled'));
		expect((await getSub(referee)).tier).toBe('free');

		// ...and resubscribes at full price.
		const second = await startCheckout(referee, 'annual');
		expect(second.discounts).toBeUndefined();
	});
});
