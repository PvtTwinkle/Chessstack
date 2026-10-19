// Referral discount activation.
//
// Called after a user verifies their email. If they were referred by another user,
// both parties get referral_discount_active = true on their subscription row.
// The discount (a pre-created Stripe coupon, 50% off, duration: once) is applied
// automatically at the next annual checkout. If the referrer already has an active
// annual subscription, the coupon is applied immediately so it discounts their
// next renewal.

import { db } from '$lib/db';
import { user, subscription } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { getStripe, STRIPE_PRICE_ID_ANNUAL, STRIPE_REFERRAL_COUPON_ID } from '$lib/stripe/client';

export async function activateReferralDiscount(refereeUserId: number): Promise<void> {
	const [refereeUser] = await db
		.select({ referredByUserId: user.referredByUserId })
		.from(user)
		.where(eq(user.id, refereeUserId));

	const referrerId = refereeUser?.referredByUserId;
	if (!referrerId) return;

	// Each flag is set by one conditional upsert, so of two callers racing
	// (the same referee verifying twice, or two referees of one referrer) only
	// one gets a row back and goes on.
	const [referee] = await flagDiscount(refereeUserId);
	if (!referee) return;

	const [referrerSub] = await flagDiscount(referrerId);
	if (!referrerSub) return;

	// Apply the coupon now if the referrer is already on an active annual
	// subscription (it will discount their next renewal). A monthly referrer's
	// discount waits for an annual checkout.
	const stripe = getStripe();
	if (
		!stripe ||
		!STRIPE_REFERRAL_COUPON_ID ||
		!referrerSub.stripeSubscriptionId ||
		referrerSub.status !== 'active' ||
		referrerSub.stripePriceId !== STRIPE_PRICE_ID_ANNUAL
	) {
		return;
	}

	try {
		await stripe.subscriptions.update(referrerSub.stripeSubscriptionId, {
			discounts: [{ coupon: STRIPE_REFERRAL_COUPON_ID }]
		});
	} catch (err) {
		// Unflag the referrer so their next referral tries again, rather than
		// leaving a reward that was promised and never applied.
		await db
			.update(subscription)
			.set({ referralDiscountActive: false, updatedAt: new Date() })
			.where(eq(subscription.userId, referrerId));
		throw err;
	}

	// The coupon is now consumed — don't apply it again at a future checkout.
	await db
		.update(subscription)
		.set({ referralDiscountUsedAt: new Date(), updatedAt: new Date() })
		.where(eq(subscription.userId, referrerId));
}

/** Sets referralDiscountActive; returns the row only if it wasn't set before. */
function flagDiscount(userId: number) {
	const now = new Date();
	return db
		.insert(subscription)
		.values({
			userId,
			tier: 'free',
			status: 'active',
			referralDiscountActive: true,
			createdAt: now,
			updatedAt: now
		})
		.onConflictDoUpdate({
			target: subscription.userId,
			set: { referralDiscountActive: true, updatedAt: now },
			setWhere: eq(subscription.referralDiscountActive, false)
		})
		.returning({
			stripeSubscriptionId: subscription.stripeSubscriptionId,
			stripePriceId: subscription.stripePriceId,
			status: subscription.status
		});
}
