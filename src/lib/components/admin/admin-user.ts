// Shared types and formatting helpers for the admin user list.

/** One row of the admin user list, as returned by src/routes/admin/+page.server.ts. */
export interface AdminUser {
	id: number;
	username: string;
	email: string | null;
	role: string;
	enabled: boolean;
	emailVerified: boolean;
	createdAt: Date | string;
	tier: 'free' | 'paid';
	subscriptionStatus: 'active' | 'past_due' | 'canceled' | null;
	giftExpiry: Date | string | null;
	isGifted: boolean;
	currentPeriodEnd: Date | string | null;
	cancelAtPeriodEnd: boolean;
}

/** Gifts with an expiry in this year or later are shown as "Lifetime". */
const LIFETIME_YEAR = 9999;

export function isLifetimeGift(d: Date | string | null): boolean {
	if (!d) return false;
	return new Date(d).getFullYear() >= LIFETIME_YEAR;
}

/** Short, locale-aware date such as "Jan 1, 2025". Empty string for no date. */
export function formatDate(d: Date | string | null): string {
	if (!d) return '';
	return new Date(d).toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric'
	});
}
