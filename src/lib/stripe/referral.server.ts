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

	// Idempotency: bail if referee already has the flag set.
	const [refereeSub] = await db
		.select({ referralDiscountActive: subscription.referralDiscountActive })
		.from(subscription)
		.where(eq(subscription.userId, refereeUserId));

	if (refereeSub?.referralDiscountActive) return;

	// Flag the referee.
	if (refereeSub) {
		await db
			.update(subscription)
			.set({ referralDiscountActive: true, updatedAt: new Date() })
			.where(eq(subscription.userId, refereeUserId));
	} else {
		await db.insert(subscription).values({
			userId: refereeUserId,
			tier: 'free',
			status: 'active',
			referralDiscountActive: true,
			createdAt: new Date(),
			updatedAt: new Date()
		});
	}

	// Flag the referrer, and apply the coupon immediately if they are already
	// on an active annual subscription (it will discount their next renewal).
	const [referrerSub] = await db
		.select({
			stripeSubscriptionId: subscription.stripeSubscriptionId,
			stripePriceId: subscription.stripePriceId,
			status: subscription.status,
			referralDiscountActive: subscription.referralDiscountActive
		})
		.from(subscription)
		.where(eq(subscription.userId, referrerId));

	if (!referrerSub?.referralDiscountActive) {
		if (referrerSub) {
			await db
				.update(subscription)
				.set({ referralDiscountActive: true, updatedAt: new Date() })
				.where(eq(subscription.userId, referrerId));
		} else {
			await db.insert(subscription).values({
				userId: referrerId,
				tier: 'free',
				status: 'active',
				referralDiscountActive: true,
				createdAt: new Date(),
				updatedAt: new Date()
			});
		}

		const stripe = getStripe();
		if (
			stripe &&
			STRIPE_REFERRAL_COUPON_ID &&
			referrerSub?.stripeSubscriptionId &&
			referrerSub.status === 'active' &&
			referrerSub.stripePriceId === STRIPE_PRICE_ID_ANNUAL
		) {
			await stripe.subscriptions.update(referrerSub.stripeSubscriptionId, {
				discounts: [{ coupon: STRIPE_REFERRAL_COUPON_ID }]
			});
			// The coupon is now consumed — don't apply it again at a future checkout.
			await db
				.update(subscription)
				.set({ referralDiscountUsedAt: new Date(), updatedAt: new Date() })
				.where(eq(subscription.userId, referrerId));
		}
	}
}
