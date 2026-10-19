// Admin gifts: granting and revoking only touch giftExpiry, so paid access
// ends with the gift and falls back to whatever the user pays for in Stripe.

import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { db, getRawSql } from '$lib/db';
import { subscription } from '$lib/db/schema';
import { resetDb, createUser, createSubscription } from '$lib/test/db-helpers';
import { effectiveTier } from './tiers';

const { PATCH } = await import('../../routes/api/admin/users/[id]/subscription/+server');

const DAY = 24 * 60 * 60 * 1000;

async function gift(adminId: number, targetId: number, body: object) {
	const request = new Request('http://localhost/api/admin/users/x/subscription', {
		method: 'PATCH',
		body: JSON.stringify(body)
	});
	const locals = { user: { id: adminId, username: 'admin', role: 'admin', tier: 'paid' } };
	return PATCH({ locals, request, params: { id: String(targetId) } } as never);
}

async function getSub(userId: number) {
	const [row] = await db.select().from(subscription).where(eq(subscription.userId, userId));
	return row;
}

let admin: number;

beforeEach(async () => {
	await resetDb();
	admin = await createUser({ role: 'admin' });
});

describe('PATCH /api/admin/users/[id]/subscription', () => {
	it('grants paid access that ends when the gift expires', async () => {
		const u = await createUser();
		await gift(admin, u, { action: 'grant', duration: '1_month' });

		const sub = await getSub(u);
		expect(sub.tier).toBe('free');
		expect(effectiveTier(sub)).toBe('paid');
		expect(effectiveTier(sub, new Date(Date.now() + 40 * DAY))).toBe('free');
	});

	it('leaves a paying subscriber paid after the gift expires', async () => {
		const u = await createUser();
		await createSubscription(u, { tier: 'paid', stripeSubscriptionId: 'sub_1' });
		await gift(admin, u, { action: 'grant', duration: '1_month' });

		const sub = await getSub(u);
		expect(sub.tier).toBe('paid');
		expect(effectiveTier(sub, new Date(Date.now() + 40 * DAY))).toBe('paid');
	});

	it('revoking ends a gift immediately but keeps a Stripe subscription', async () => {
		const gifted = await createUser();
		await gift(admin, gifted, { action: 'grant', duration: 'lifetime' });
		await gift(admin, gifted, { action: 'revoke' });
		expect(effectiveTier(await getSub(gifted))).toBe('free');

		const paying = await createUser();
		await createSubscription(paying, { tier: 'paid', stripeSubscriptionId: 'sub_2' });
		await gift(admin, paying, { action: 'grant', duration: '1_year' });
		await gift(admin, paying, { action: 'revoke' });
		expect(await getSub(paying)).toMatchObject({ tier: 'paid', giftExpiry: null });
	});
});

describe('migration 0037_gift_tier_from_stripe', () => {
	it('resets gifted rows to their Stripe tier and leaves the rest alone', async () => {
		const expired = new Date(Date.now() - DAY);
		const future = new Date(Date.now() + DAY);

		// Rows as the old gift code left them: tier = 'paid' on every gift.
		const expiredGift = await createUser();
		await createSubscription(expiredGift, { tier: 'paid', giftExpiry: expired });
		const activeGift = await createUser();
		await createSubscription(activeGift, { tier: 'paid', giftExpiry: future });
		const giftAndPaying = await createUser();
		await createSubscription(giftAndPaying, {
			tier: 'paid',
			giftExpiry: expired,
			stripeSubscriptionId: 'sub_a',
			status: 'past_due'
		});
		const giftAndCanceled = await createUser();
		await createSubscription(giftAndCanceled, {
			tier: 'paid',
			giftExpiry: future,
			stripeSubscriptionId: 'sub_b',
			status: 'canceled'
		});
		const payingNoGift = await createUser();
		await createSubscription(payingNoGift, { tier: 'paid', stripeSubscriptionId: 'sub_c' });

		const migration = readFileSync('drizzle/migrations/0037_gift_tier_from_stripe.sql', 'utf8');
		await getRawSql().unsafe(migration);

		expect((await getSub(expiredGift)).tier).toBe('free');
		expect(effectiveTier(await getSub(expiredGift))).toBe('free');
		expect((await getSub(activeGift)).tier).toBe('free');
		expect(effectiveTier(await getSub(activeGift))).toBe('paid');
		expect((await getSub(giftAndPaying)).tier).toBe('paid');
		expect((await getSub(giftAndCanceled)).tier).toBe('free');
		expect(effectiveTier(await getSub(giftAndCanceled))).toBe('paid');
		expect((await getSub(payingNoGift)).tier).toBe('paid');
	});
});
