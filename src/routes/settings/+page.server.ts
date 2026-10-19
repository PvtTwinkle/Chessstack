// Settings page server load.
//
// User settings come from the layout load, which every page already merges in.
// This file also fetches the subscription so the billing UI can show status,
// period end, and cancellation state. Only the columns the page uses are sent
// to the browser.

import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { user as userTable, subscription } from '$lib/db/schema';
import { eq, count, and } from 'drizzle-orm';
import { generateReferralCode } from '$lib/auth/referral-code';
import { IS_CLOUD } from '$lib/server/edition';

export const load: PageServerLoad = async ({ locals }) => {
	// Fetch full subscription details for the billing section.
	let sub = null;
	let referralCode: string | null = null;
	let referralCount = 0;

	// Self-hosted instances have no plans or referrals, so there is nothing to load.
	if (locals.user && IS_CLOUD) {
		const [row] = await db
			.select({
				status: subscription.status,
				stripePriceId: subscription.stripePriceId,
				currentPeriodEnd: subscription.currentPeriodEnd,
				cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
				giftExpiry: subscription.giftExpiry,
				referralDiscountActive: subscription.referralDiscountActive,
				referralDiscountUsedAt: subscription.referralDiscountUsedAt
			})
			.from(subscription)
			.where(eq(subscription.userId, locals.user.id));
		sub = row ?? null;

		const [userRow] = await db
			.select({ referralCode: userTable.referralCode })
			.from(userTable)
			.where(eq(userTable.id, locals.user.id));
		referralCode = userRow?.referralCode ?? null;

		// Lazily generate a referral code for existing users who pre-date the feature.
		if (!referralCode) {
			referralCode = generateReferralCode();
			await db.update(userTable).set({ referralCode }).where(eq(userTable.id, locals.user.id));
		}

		const [{ value }] = await db
			.select({ value: count() })
			.from(userTable)
			.where(
				and(eq(userTable.referredByUserId, locals.user.id), eq(userTable.emailVerified, true))
			);
		referralCount = value;
	}

	return {
		subscription: sub && {
			status: sub.status,
			stripePriceId: sub.stripePriceId,
			currentPeriodEnd: sub.currentPeriodEnd,
			cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
			giftExpiry: sub.giftExpiry
		},
		referralCode,
		referralCount,
		referralDiscountActive: sub?.referralDiscountActive ?? false,
		referralDiscountUsed: sub?.referralDiscountUsedAt != null
	};
};
