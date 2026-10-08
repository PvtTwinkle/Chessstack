// PATCH /api/admin/users/[id]/subscription — Gift or revoke a paid subscription.
//
// Allows admins to gift paid-tier access for a set duration (1 month, 1 year,
// or lifetime) independently of Stripe. While the gift is active, Stripe
// webhooks will not downgrade the user's tier.
//
// Access is guarded by hooks.server.ts (admin role required).

import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { requireAdmin, parseIntParam } from '$lib/server/api-helpers';
import { db } from '$lib/db';
import { user, subscription, auditLog } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { parseBody } from '$lib/server/validation';
import { giftSubscriptionSchema } from '$lib/server/schemas/admin';

// Lifetime gifts use a far-future sentinel date.
const LIFETIME_SENTINEL = new Date('9999-12-31T00:00:00.000Z');

type Duration = '1_month' | '1_year' | 'lifetime';

function computeGiftExpiry(duration: Duration): Date {
	if (duration === 'lifetime') return LIFETIME_SENTINEL;
	const now = new Date();
	if (duration === '1_month') {
		now.setMonth(now.getMonth() + 1);
	} else {
		now.setFullYear(now.getFullYear() + 1);
	}
	return now;
}

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const admin = requireAdmin(locals);
	const targetId = parseIntParam(params.id, 'user ID');

	const body = await parseBody(request, giftSubscriptionSchema);

	// Verify target user exists
	const [target] = await db.select({ id: user.id }).from(user).where(eq(user.id, targetId));
	if (!target) throw error(404, 'User not found');

	const now = new Date();

	// Check for an existing subscription row
	const [existing] = await db
		.select({
			id: subscription.id,
			tier: subscription.tier,
			status: subscription.status,
			stripeSubscriptionId: subscription.stripeSubscriptionId
		})
		.from(subscription)
		.where(eq(subscription.userId, targetId));

	let auditDetails: string;

	if (body.action === 'grant') {
		const { duration } = body;
		const giftExpiry = computeGiftExpiry(duration);

		if (existing) {
			await db
				.update(subscription)
				.set({ giftExpiry, tier: 'paid', updatedAt: now })
				.where(eq(subscription.userId, targetId));
		} else {
			await db.insert(subscription).values({
				userId: targetId,
				tier: 'paid',
				status: 'active',
				giftExpiry,
				createdAt: now,
				updatedAt: now
			});
		}
		auditDetails = `gift=${duration}`;
	} else {
		// Revoke gift
		if (existing) {
			// Derive the correct tier from the Stripe-side status.
			let revertTier: 'free' | 'paid' = 'free';
			if (
				existing.stripeSubscriptionId &&
				(existing.status === 'active' || existing.status === 'past_due')
			) {
				revertTier = 'paid';
			}

			await db
				.update(subscription)
				.set({ giftExpiry: null, tier: revertTier, updatedAt: now })
				.where(eq(subscription.userId, targetId));
		}
		auditDetails = 'gift=revoked';
	}

	// Audit log
	await db.insert(auditLog).values({
		adminUserId: admin.id,
		action: 'gift_subscription',
		targetUserId: targetId,
		details: auditDetails,
		createdAt: now
	});

	return json({ success: true });
};
