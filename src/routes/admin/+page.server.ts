// Admin panel — data loader.
// hooks.server.ts already sends non-admins away from /admin; requireAdmin
// here keeps the load safe if that guard ever changes.

import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { user, subscription } from '$lib/db/schema';
import { eq, or, ilike, count } from 'drizzle-orm';
import { requireAdmin } from '$lib/server/api-helpers';
import { effectiveTier, isGiftActive } from '$lib/stripe/tiers';

const REGISTRATION_MODE = process.env.REGISTRATION_MODE ?? 'invite';
const PAGE_SIZE = 50;

// % and _ are wildcards to ilike; a search for "a_b" means the literal text.
function escapeLike(text: string): string {
	return text.replace(/[\\%_]/g, (c) => '\\' + c);
}

export const load: PageServerLoad = async ({ locals, url }) => {
	requireAdmin(locals);
	const searchQuery = url.searchParams.get('q')?.trim() || '';
	const page = Math.max(1, parseInt(url.searchParams.get('page') || '1') || 1);
	const offset = (page - 1) * PAGE_SIZE;

	// Build optional search filter
	const pattern = `%${escapeLike(searchQuery)}%`;
	const searchFilter = searchQuery
		? or(ilike(user.username, pattern), ilike(user.email, pattern))
		: undefined;

	// Count total matching users (for pagination)
	const [{ total }] = await db.select({ total: count() }).from(user).where(searchFilter);

	// Fetch users with subscription data via left join
	const rows = await db
		.select({
			id: user.id,
			username: user.username,
			email: user.email,
			role: user.role,
			enabled: user.enabled,
			emailVerified: user.emailVerified,
			createdAt: user.createdAt,
			tier: subscription.tier,
			subscriptionStatus: subscription.status,
			giftExpiry: subscription.giftExpiry,
			currentPeriodEnd: subscription.currentPeriodEnd,
			cancelAtPeriodEnd: subscription.cancelAtPeriodEnd
		})
		.from(user)
		.leftJoin(subscription, eq(user.id, subscription.userId))
		.where(searchFilter)
		.orderBy(user.createdAt)
		.limit(PAGE_SIZE)
		.offset(offset);

	// Normalize nulls from the left join into sensible defaults
	const users = rows.map((r) => ({
		id: r.id,
		username: r.username,
		email: r.email,
		role: r.role,
		enabled: r.enabled,
		emailVerified: r.emailVerified,
		createdAt: r.createdAt,
		tier: effectiveTier({ tier: r.tier ?? 'free', giftExpiry: r.giftExpiry }),
		subscriptionStatus: (r.subscriptionStatus as 'active' | 'past_due' | 'canceled') ?? null,
		giftExpiry: r.giftExpiry,
		isGifted: isGiftActive(r.giftExpiry),
		currentPeriodEnd: r.currentPeriodEnd,
		cancelAtPeriodEnd: r.cancelAtPeriodEnd ?? false
	}));

	return {
		users,
		registrationMode: REGISTRATION_MODE,
		searchQuery,
		page,
		totalUsers: total,
		totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE))
	};
};
