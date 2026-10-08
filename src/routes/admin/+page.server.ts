// Admin panel — data loader.
// Access is already guarded by hooks.server.ts (admin role required).

import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { user, subscription } from '$lib/db/schema';
import { eq, or, ilike, count } from 'drizzle-orm';

const REGISTRATION_MODE = process.env.REGISTRATION_MODE ?? 'invite';
const PAGE_SIZE = 50;

export const load: PageServerLoad = async ({ url }) => {
	const searchQuery = url.searchParams.get('q')?.trim() || '';
	const page = Math.max(1, parseInt(url.searchParams.get('page') || '1') || 1);
	const offset = (page - 1) * PAGE_SIZE;

	// Build optional search filter
	const searchFilter = searchQuery
		? or(ilike(user.username, `%${searchQuery}%`), ilike(user.email, `%${searchQuery}%`))
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
		tier: (r.tier as 'free' | 'paid') ?? 'free',
		subscriptionStatus: (r.subscriptionStatus as 'active' | 'past_due' | 'canceled') ?? null,
		giftExpiry: r.giftExpiry,
		isGifted: r.giftExpiry != null && r.giftExpiry > new Date(),
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
