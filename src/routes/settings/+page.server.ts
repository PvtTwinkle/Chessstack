// Settings page server load.
//
// User settings come from the layout load (no duplicate query needed).
// This file also fetches the full subscription row so the billing UI
// can show status, period end, and cancellation state.

import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { user as userTable, subscription } from '$lib/db/schema';
import { eq, count, and } from 'drizzle-orm';
import { generateReferralCode } from '$lib/auth/referral-code';
import { IS_CLOUD } from '$lib/server/edition';

export const load: PageServerLoad = async ({ parent, locals }) => {
	const { settings } = await parent();

	// Fetch full subscription details for the billing section.
	let sub = null;
	let referralCode: string | null = null;
	let referralCount = 0;

	// Self-hosted instances have no plans or referrals, so there is nothing to load.
	if (locals.user && IS_CLOUD) {
		const [row] = await db
			.select()
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
		settings,
		subscription: sub,
		referralCode,
		referralCount,
		referralDiscountActive: sub?.referralDiscountActive ?? false,
		referralDiscountUsed: sub?.referralDiscountUsedAt != null
	};
};
